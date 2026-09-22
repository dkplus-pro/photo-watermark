// Package media 媒体资源业务:上传(校验 → 存储 → 提取 → 记录)、列表、详情、删除(级联底层文件)。
// 底层文件经 internal/storage 与 files 表,信息提取按类型走 Extractor(见 docs/mvp-plan.md 阶段 5 修订)。
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/storage"
)

// 媒体类型。
const (
	KindImage = "image"
	KindVideo = "video"
	KindAudio = "audio"
)

// 上传大小上限(MVP 常量,后续迁 storage 配置组)。
// 视频上限 2GB:分片上传启用后按 admin-enhancement-plan 阶段 14 放开,
// 单发 multipart 上传沿用同一常量(视频走流式,不吃内存)。
const (
	ImageMaxBytes = 10 << 20 // 10MB
	VideoMaxBytes = 2 << 30  // 2GB
)

// 各类型允许的扩展名。
var allowedExts = map[string][]string{
	KindImage: {".png", ".jpg", ".jpeg", ".gif", ".webp"},
	KindVideo: {".mp4", ".webm", ".mov"},
}

var maxBytes = map[string]int64{
	KindImage: ImageMaxBytes,
	KindVideo: VideoMaxBytes,
}

// 媒体模块业务错误。
var (
	ErrInvalidType = errors.New("invalid media type")
	ErrTooLarge    = errors.New("file too large")

	ErrGroupNameExists  = errors.New("media group name exists") // 同类型下分组名重复
	ErrInvalidGroup     = errors.New("invalid media group")     // 分组不存在或与媒体类型不匹配
	ErrInvalidGroupName = errors.New("invalid media group name")
)

// ErrMediaNotFound 媒体资源不存在;ErrMediaGroupNotFound 分组不存在。
// 两者在本包出口由 repo 哨兵转译而来(转译边界见 apps/server/AGENTS.md §3)。
var (
	ErrMediaNotFound      = errors.New("media not found")
	ErrMediaGroupNotFound = errors.New("media group not found")
)

// Service 媒体资源业务。
type Service struct {
	db      *gorm.DB
	storage storage.Storage
}

// NewService 装配媒体服务。
func NewService(db *gorm.DB, store storage.Storage) *Service {
	return &Service{db: db, storage: store}
}

// Asset 媒体资源出参:media_assets + 底层 files 信息已合并,meta 按类型展开。
type Asset struct {
	ID        int64
	FileID    int64
	Title     string
	OrigName  string
	Size      int64
	URL       string // 外网访问地址(CDN 直链);local 存储为空串
	Width     int    // image
	Height    int    // image
	Format    string
	GroupID   int64  // 所属分组,0=未分组
	GroupName string // 所属分组名,未分组为空串
	CreatedAt time.Time
}

// Upload 上传媒体:校验扩展名与大小 → 存介质 → files 记录 → 提取 → media_assets 记录。
// 图片(≤10MB)先读入内存,Save 与宽高提取复用同一份字节,避免 OSS 上传后再回源下载;
// 视频(≤200MB)流式上传,meta 暂无提取需求。groupID 为可选分组(0=未分组,须为同类型分组)。
func (s *Service) Upload(ctx context.Context, kind, origName, contentType string, r io.Reader, uploaderID, groupID int64) (Asset, error) {
	ext := strings.ToLower(filepath.Ext(origName))
	if err := validateType(kind, ext); err != nil {
		return Asset{}, err
	}
	if err := s.validateGroupOfKind(ctx, kind, groupID); err != nil {
		return Asset{}, err
	}

	var data []byte // 仅图片非空
	var name string
	var size int64
	var err error
	if kind == KindImage {
		data, err = io.ReadAll(io.LimitReader(r, maxBytes[kind]+1))
		if err != nil {
			return Asset{}, fmt.Errorf("read upload: %w", err)
		}
		if int64(len(data)) > maxBytes[kind] {
			return Asset{}, ErrTooLarge
		}
		name, size, err = s.storage.Save(ctx, bytes.NewReader(data), strings.TrimPrefix(ext, "."))
	} else {
		limited := io.LimitReader(r, maxBytes[kind]+1)
		name, size, err = s.storage.Save(ctx, limited, strings.TrimPrefix(ext, "."))
	}
	if err != nil {
		return Asset{}, err
	}
	if size > maxBytes[kind] {
		_ = s.storage.Delete(ctx, name)
		return Asset{}, ErrTooLarge
	}

	file := repo.File{
		OrigName: filepath.Base(origName), Name: name, Path: name,
		Mime: contentType, Size: size,
		Storage: s.storage.Driver(), Url: s.storage.URL(name),
		UploaderID: uploaderID,
	}
	if err := repo.CreateFile(ctx, s.db, &file); err != nil {
		_ = s.storage.Delete(ctx, name)
		return Asset{}, err
	}

	meta := extractMeta(kind, data)

	asset := repo.MediaAsset{
		Kind: kind, FileID: file.ID, Title: file.OrigName,
		Meta: encodeMeta(meta), GroupID: groupID, UploaderID: uploaderID,
	}
	if err := repo.CreateMediaAsset(ctx, s.db, &asset); err != nil {
		_ = s.storage.Delete(ctx, name)
		_ = repo.DeleteFile(ctx, s.db, file.ID)
		return Asset{}, err
	}

	verb, title := describeUpload(kind, asset.Title, meta)
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "media.upload", Resource: kind, ResourceID: fmt.Sprint(asset.ID),
		Description: verb + title,
	}, "")
	groupName := ""
	if groupID > 0 {
		groupName = s.groupNameOf(ctx, groupID)
	}
	out := s.toAsset(asset, file)
	out.GroupID, out.GroupName = groupID, groupName
	return out, nil
}

// List 媒体分页(合并底层文件信息;groupID nil=全部,0=未分组,>0=指定分组)。
func (s *Service) List(ctx context.Context, kind string, groupID *int64, page, pageSize int) ([]Asset, int64, error) {
	assets, total, err := repo.ListMediaAssets(ctx, s.db, kind, groupID, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	// 批量富化分组名,避免逐条回查。
	groupIDs := make([]int64, 0, len(assets))
	for _, asset := range assets {
		if asset.GroupID > 0 {
			groupIDs = append(groupIDs, asset.GroupID)
		}
	}
	groupNames, err := repo.GetMediaGroupNames(ctx, s.db, kind, groupIDs)
	if err != nil {
		return nil, 0, err
	}
	items := make([]Asset, 0, len(assets))
	for _, asset := range assets {
		item, err := s.toAssetE(ctx, asset)
		if err != nil {
			return nil, 0, err
		}
		item.GroupID = asset.GroupID
		item.GroupName = groupNames[asset.GroupID]
		items = append(items, item)
	}
	return items, total, nil
}

// Get 媒体详情。
func (s *Service) Get(ctx context.Context, id int64) (Asset, error) {
	asset, err := repo.GetMediaAssetByID(ctx, s.db, id)
	if err != nil {
		return Asset{}, translateMediaErr(err)
	}
	out, err := s.toAssetE(ctx, asset)
	if err != nil {
		return Asset{}, err
	}
	out.GroupID = asset.GroupID
	if asset.GroupID > 0 {
		out.GroupName = s.groupNameOf(ctx, asset.GroupID)
	}
	return out, nil
}

// FileInfo 底层文件记录的出参视图(repo 模型不透出业务包)。
type FileInfo struct {
	ID         int64
	OrigName   string
	Name       string // 存储对象名
	Mime       string
	Size       int64
	Storage    string
	Url        string // CDN 直链;local 存储为空串
	UploaderID int64
	CreatedAt  time.Time
}

// GetFile 底层文件记录(内容流端点用)。
func (s *Service) GetFile(ctx context.Context, id int64) (FileInfo, error) {
	file, err := repo.GetFileByID(ctx, s.db, id)
	if err != nil {
		return FileInfo{}, translateMediaErr(err)
	}
	return FileInfo{
		ID: file.ID, OrigName: file.OrigName, Name: file.Name, Mime: file.Mime,
		Size: file.Size, Storage: file.Storage, Url: file.Url,
		UploaderID: file.UploaderID, CreatedAt: file.CreatedAt,
	}, nil
}

// translateMediaErr repo 哨兵 → 本包哨兵的单点转译;非目标错误原样透传。
func translateMediaErr(err error) error {
	switch {
	case errors.Is(err, repo.ErrFileNotFound):
		return ErrMediaNotFound
	case errors.Is(err, repo.ErrMediaGroupNotFound):
		return ErrMediaGroupNotFound
	default:
		return err
	}
}

// Open 打开介质文件(本地内容端点用;本地实现返回 *os.File,可断言 io.ReadSeeker)。
func (s *Service) Open(ctx context.Context, name string) (io.ReadCloser, error) {
	return s.storage.Open(ctx, name)
}

func (s *Service) toAsset(asset repo.MediaAsset, file repo.File) Asset {
	out := Asset{
		ID: asset.ID, FileID: asset.FileID, Title: asset.Title,
		OrigName: file.OrigName, Size: file.Size, URL: file.Url, CreatedAt: asset.CreatedAt,
	}
	meta := decodeMeta(asset.Meta)
	out.Width, _ = strconv.Atoi(meta["width"])
	out.Height, _ = strconv.Atoi(meta["height"])
	out.Format = meta["format"]
	return out
}

func (s *Service) toAssetE(ctx context.Context, asset repo.MediaAsset) (Asset, error) {
	file, err := repo.GetFileByID(ctx, s.db, asset.FileID)
	if err != nil {
		return Asset{}, translateMediaErr(err)
	}
	return s.toAsset(asset, file), nil
}

// Delete 删除媒体:级联删除底层文件记录与介质(记业务日志)。
// 介质只在记录与当前驱动一致时删除;驱动切换后遗留的跨驱动记录只删库,
// 对象清理由运维按旧驱动介质另行处理(不在此处用错驱动误删/报错)。
func (s *Service) Delete(ctx context.Context, id int64) error {
	asset, err := repo.GetMediaAssetByID(ctx, s.db, id)
	if err != nil {
		return translateMediaErr(err)
	}
	file, err := repo.GetFileByID(ctx, s.db, asset.FileID)
	if err != nil {
		return translateMediaErr(err)
	}
	if file.Storage == s.storage.Driver() {
		if err := s.storage.Delete(ctx, file.Name); err != nil {
			return err
		}
	}
	if err := repo.DeleteMediaAsset(ctx, s.db, id); err != nil {
		return err
	}
	if err := repo.DeleteFile(ctx, s.db, asset.FileID); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "media.delete", Resource: asset.Kind, ResourceID: fmt.Sprint(asset.ID),
		Description: "删除" + kindLabel(asset.Kind) + " " + asset.Title,
	}, "")
	return nil
}

func kindLabel(kind string) string {
	switch kind {
	case KindImage:
		return "图片"
	case KindVideo:
		return "视频"
	case KindAudio:
		return "音频"
	}
	return kind
}

func describeUpload(kind, title string, meta map[string]string) (verb, text string) {
	verb = "上传" + kindLabel(kind)
	if w, h := meta["width"], meta["height"]; w != "" && h != "" {
		return verb, fmt.Sprintf(" %s(%sx%s)", title, w, h)
	}
	return verb, " " + title
}

func decodeMeta(encoded string) map[string]string {
	meta := map[string]string{}
	if encoded == "" {
		return meta
	}
	if err := json.Unmarshal([]byte(encoded), &meta); err != nil {
		return map[string]string{}
	}
	return meta
}

func encodeMeta(meta map[string]string) string {
	if len(meta) == 0 {
		return ""
	}
	encoded, err := json.Marshal(meta)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// ValidateFile 校验媒体类型与扩展名,返回该类型的大小上限(分片上传会话初始化复用)。
func ValidateFile(kind, origName string) (int64, error) {
	ext := strings.ToLower(filepath.Ext(origName))
	if err := validateType(kind, ext); err != nil {
		return 0, err
	}
	return maxBytes[kind], nil
}

// validateType 扩展名白名单校验(图片另在提取时做内容校验)。
func validateType(kind, ext string) error {
	allowed, ok := allowedExts[kind]
	if !ok {
		return ErrInvalidType
	}
	for _, a := range allowed {
		if a == ext {
			return nil
		}
	}
	return ErrInvalidType
}

// extractMeta 按类型提取信息;图片从上传字节解析宽高与格式(内容校验),视频/音频预留 ffprobe。
func extractMeta(kind string, data []byte) map[string]string {
	meta := map[string]string{}
	if kind != KindImage || len(data) == 0 {
		return meta // video/audio:预留 ffprobe 提取时长/分辨率,拿到后写进 meta 即可
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return meta // 内容不是可解码图片,meta 留空;下次列表仍可见
	}
	meta["width"] = fmt.Sprint(cfg.Width)
	meta["height"] = fmt.Sprint(cfg.Height)
	meta["format"] = format
	return meta
}
