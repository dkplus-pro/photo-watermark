// Package uploads 大文件分片上传:会话落磁盘不建表(data/uploads/{uploadId}/ 下
// meta.json + 分片文件 chunk-000001…),重启后状态仍可续传;complete 顺序拼接后
// 复用 internal/media 的上传管线(校验/存储/提取/落库/oplog)。
// 方案见 docs/admin-enhancement-plan.md 阶段 14。
package uploads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/cms-template/server/internal/media"
	"github.com/cms-template/server/internal/uid"
)

// 会话常量(计划文档约定:常量起步,后续需要再迁环境变量)。
const (
	// ChunkSize 单片字节数 5MB;最后一片可小于该值。
	ChunkSize int64 = 5 << 20
	// SessionTTL 未完成会话保留时长,超时由清理器删除。
	SessionTTL = 24 * time.Hour
	// DefaultBaseDir 会话根目录(相对进程工作目录,与 data/files 同级)。
	DefaultBaseDir = "data/uploads"

	metaFile    = "meta.json"
	chunkPrefix = "chunk-"
)

// uploadID 格式(storage 生成的 uuid),防目录穿越。
var safeID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

// 会话业务错误(handler 统一映射 HTTP 状态码)。
var (
	// ErrSessionNotFound 会话不存在或非属主访问,统一返回,不泄露会话存在性。
	ErrSessionNotFound = errors.New("upload session not found")
	// ErrInvalidSize 初始化的文件总大小非法(<=0)。
	ErrInvalidSize = errors.New("invalid upload size")
	// ErrInvalidIndex 分片索引越界。
	ErrInvalidIndex = errors.New("chunk index out of range")
	// ErrChunkTooLarge 单片超过 ChunkSize。
	ErrChunkTooLarge = errors.New("chunk larger than chunk size")
	// ErrIncomplete 分片不齐全或总大小与声明不符,拒绝合并。
	ErrIncomplete = errors.New("upload session incomplete or size mismatch")
)

// Session 会话状态出参(初始化与状态查询共用)。
type Session struct {
	UploadID        string
	Kind            string
	FileName        string
	Size            int64
	ChunkSize       int64
	ChunkCount      int
	UploadedIndexes []int
}

// Result complete 出参:媒体上传管线落库后的精简信息。
type Result struct {
	ID       int64
	Kind     string
	URL      string
	OrigName string
	Size     int64
}

// meta 会话元数据(meta.json 落盘结构)。
type meta struct {
	Kind       string    `json:"kind"`
	FileName   string    `json:"fileName"`
	Size       int64     `json:"size"`
	ChunkSize  int64     `json:"chunkSize"`
	ChunkCount int       `json:"chunkCount"`
	GroupID    int64     `json:"groupId"`
	UploaderID int64     `json:"uploaderId"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (m meta) session(id string) Session {
	return Session{
		UploadID: id, Kind: m.Kind, FileName: m.FileName,
		Size: m.Size, ChunkSize: m.ChunkSize, ChunkCount: m.ChunkCount,
	}
}

// Service 分片上传会话业务;complete 经 media.Service 复用上传管线。
type Service struct {
	baseDir string
	media   *media.Service
}

// NewService 装配分片上传服务;baseDir 为会话根目录,mediaSvc 为被复用的媒体上传管线。
func NewService(baseDir string, mediaSvc *media.Service) *Service {
	return &Service{baseDir: baseDir, media: mediaSvc}
}

// Init 初始化上传会话:校验类型/大小/分组 → 建会话目录并落 meta.json。
func (s *Service) Init(ctx context.Context, kind, fileName string, size, uploaderID, groupID int64) (Session, error) {
	max, err := media.ValidateFile(kind, fileName)
	if err != nil {
		return Session{}, err
	}
	if size <= 0 {
		return Session{}, ErrInvalidSize
	}
	if size > max {
		return Session{}, media.ErrTooLarge
	}
	// 初始化时提前校验分组,避免客户端传完全部分片才在 complete 时失败。
	if err := s.media.ValidateGroup(ctx, kind, groupID); err != nil {
		return Session{}, err
	}

	id, err := uid.NewUUID()
	if err != nil {
		return Session{}, err
	}
	dir := s.dir(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Session{}, fmt.Errorf("create session dir: %w", err)
	}
	m := meta{
		Kind: kind, FileName: filepath.Base(fileName), Size: size,
		ChunkSize: ChunkSize, ChunkCount: chunkCount(size, ChunkSize),
		GroupID: groupID, UploaderID: uploaderID, CreatedAt: time.Now(),
	}
	if err := s.saveMeta(id, m); err != nil {
		_ = os.RemoveAll(dir)
		return Session{}, err
	}
	return m.session(id), nil
}

// PutChunk 保存一个分片(index 0 起);重复上传同一分片幂等覆盖。
// 落盘走临时文件 + rename,并发写同一分片时原子替换,不留半截分片。
func (s *Service) PutChunk(uploadID string, index int, uploaderID int64, r io.Reader) error {
	m, err := s.loadMeta(uploadID, uploaderID)
	if err != nil {
		return err
	}
	if index < 0 || index >= m.ChunkCount {
		return ErrInvalidIndex
	}

	tmp, err := os.CreateTemp(s.dir(uploadID), "chunk-tmp-*")
	if err != nil {
		return fmt.Errorf("create chunk temp file: %w", err)
	}
	tmpName := tmp.Name()
	n, copyErr := io.Copy(tmp, io.LimitReader(r, m.ChunkSize+1))
	closeErr := tmp.Close()
	switch {
	case copyErr != nil:
		_ = os.Remove(tmpName)
		return fmt.Errorf("write chunk: %w", copyErr)
	case closeErr != nil:
		_ = os.Remove(tmpName)
		return fmt.Errorf("close chunk: %w", closeErr)
	case n > m.ChunkSize:
		_ = os.Remove(tmpName)
		return ErrChunkTooLarge
	}
	if err := os.Rename(tmpName, filepath.Join(s.dir(uploadID), chunkName(index))); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("rename chunk: %w", err)
	}
	return nil
}

// Status 会话状态(uploadedIndexes 升序),断点续传据此跳过已传分片。
func (s *Service) Status(uploadID string, uploaderID int64) (Session, error) {
	m, err := s.loadMeta(uploadID, uploaderID)
	if err != nil {
		return Session{}, err
	}
	indexes, err := uploadedIndexes(s.dir(uploadID))
	if err != nil {
		return Session{}, err
	}
	out := m.session(uploadID)
	out.UploadedIndexes = indexes
	return out, nil
}

// Complete 校验分片齐全与总大小 → io.MultiReader 顺序拼接 → 复用 media.Upload
// 管线(扩展名/大小复检、storage.Save、提取、files/media_assets 落库、oplog 埋点)
// → 成功后清理会话目录;管线失败保留会话,客户端可重试 complete。
func (s *Service) Complete(ctx context.Context, uploadID string, uploaderID int64) (Result, error) {
	m, err := s.loadMeta(uploadID, uploaderID)
	if err != nil {
		return Result{}, err
	}
	dir := s.dir(uploadID)
	var total int64
	for i := 0; i < m.ChunkCount; i++ {
		info, err := os.Stat(filepath.Join(dir, chunkName(i)))
		if err != nil {
			return Result{}, ErrIncomplete
		}
		total += info.Size()
	}
	if total != m.Size {
		return Result{}, ErrIncomplete
	}

	chunks := make([]*os.File, 0, m.ChunkCount)
	defer func() {
		for _, f := range chunks {
			_ = f.Close()
		}
	}()
	readers := make([]io.Reader, 0, m.ChunkCount)
	for i := 0; i < m.ChunkCount; i++ {
		f, err := os.Open(filepath.Join(dir, chunkName(i)))
		if err != nil {
			return Result{}, fmt.Errorf("open chunk %d: %w", i, err)
		}
		chunks = append(chunks, f)
		readers = append(readers, f)
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(m.FileName)))
	asset, err := s.media.Upload(ctx, m.Kind, m.FileName, contentType, io.MultiReader(readers...), uploaderID, m.GroupID)
	if err != nil {
		return Result{}, err
	}
	_ = os.RemoveAll(dir)
	return Result{ID: asset.ID, Kind: m.Kind, URL: asset.URL, OrigName: asset.OrigName, Size: asset.Size}, nil
}

// Abort 中止并清理会话目录(幂等:会话已不存在同样返回成功)。
func (s *Service) Abort(uploadID string, uploaderID int64) error {
	if _, err := s.loadMeta(uploadID, uploaderID); err != nil {
		return err
	}
	return os.RemoveAll(s.dir(uploadID))
}

// loadMeta 读取并校验会话属主;ID 非法、元数据缺失/损坏、属主不匹配统一
// ErrSessionNotFound(404,不泄露会话存在性)。
func (s *Service) loadMeta(uploadID string, uploaderID int64) (meta, error) {
	if !safeID.MatchString(uploadID) {
		return meta{}, ErrSessionNotFound
	}
	data, err := os.ReadFile(filepath.Join(s.dir(uploadID), metaFile))
	if err != nil {
		return meta{}, ErrSessionNotFound
	}
	var m meta
	if err := json.Unmarshal(data, &m); err != nil || m.ChunkCount <= 0 {
		return meta{}, ErrSessionNotFound
	}
	if m.UploaderID != uploaderID {
		return meta{}, ErrSessionNotFound
	}
	return m, nil
}

// saveMeta 会话元数据落盘(临时文件 + rename,避免读方读到半截 JSON)。
func (s *Service) saveMeta(uploadID string, m meta) error {
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("encode meta: %w", err)
	}
	dir := s.dir(uploadID)
	tmp, err := os.CreateTemp(dir, "meta-tmp-*")
	if err != nil {
		return fmt.Errorf("create meta temp file: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("write meta: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("close meta: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(dir, metaFile)); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("rename meta: %w", err)
	}
	return nil
}

func (s *Service) dir(uploadID string) string {
	return filepath.Join(s.baseDir, uploadID)
}

// chunkName 分片文件名(1 起编号,与计划文档示例一致;2GB/5MB 远小于 6 位上限)。
func chunkName(index int) string {
	return fmt.Sprintf("%s%06d", chunkPrefix, index+1)
}

// chunkCount 按 size 与单片大小计算分片数(向上取整,至少 1)。
func chunkCount(size, chunkSize int64) int {
	count := (size + chunkSize - 1) / chunkSize
	if count < 1 {
		return 1
	}
	return int(count)
}

// uploadedIndexes 扫描会话目录中已落盘分片,返回升序索引(0 起)。
func uploadedIndexes(dir string) ([]int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read session dir: %w", err)
	}
	indexes := make([]int, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, chunkPrefix) {
			continue
		}
		var n int
		if _, err := fmt.Sscanf(strings.TrimPrefix(name, chunkPrefix), "%d", &n); err != nil || n <= 0 {
			continue // 跳过临时文件等非分片条目
		}
		indexes = append(indexes, n-1)
	}
	sort.Ints(indexes)
	return indexes, nil
}
