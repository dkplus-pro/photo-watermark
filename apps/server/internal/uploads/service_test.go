package uploads

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/media"
	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/storage"
)

// newUploadService 内存 SQLite + local 存储临时目录,覆盖完整链路
// (初始化/分片落盘/complete 复用 media 上传管线/清理)。
func newUploadService(t *testing.T) (*Service, *media.Service, *gorm.DB, storage.Storage) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	store, err := storage.NewLocal(filepath.Join(t.TempDir(), "files"))
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	mediaSvc := media.NewService(db, store)
	return NewService(t.TempDir(), mediaSvc), mediaSvc, db, store
}

// testBytes 生成确定性测试数据(非恒定字节,可检验拼接顺序)。
func testBytes(n int) []byte {
	data := make([]byte, n)
	for i := range data {
		data[i] = byte(i % 251)
	}
	return data
}

func putChunk(t *testing.T, s *Service, id string, index int, uploaderID int64, data []byte) {
	t.Helper()
	if err := s.PutChunk(id, index, uploaderID, bytesReader(data)); err != nil {
		t.Fatalf("put chunk %d: %v", index, err)
	}
}

func mustInit(t *testing.T, s *Service, kind, fileName string, size, uploaderID, groupID int64) Session {
	t.Helper()
	sess, err := s.Init(context.Background(), kind, fileName, size, uploaderID, groupID)
	if err != nil {
		t.Fatalf("init upload: %v", err)
	}
	return sess
}

const (
	owner  = int64(7)
	other  = int64(8)
	tenMB  = int64(10 << 20)
	fiveMB = int64(5 << 20)
)

func TestInitSession(t *testing.T) {
	s, mediaSvc, _, _ := newUploadService(t)
	ctx := context.Background()

	// 视频 12MB → 3 片(5+5+2)
	sess := mustInit(t, s, media.KindVideo, "宣传片.mp4", 12<<20, owner, 0)
	if sess.Kind != media.KindVideo || sess.ChunkSize != ChunkSize {
		t.Fatalf("unexpected session: %+v", sess)
	}
	if sess.ChunkCount != 3 || len(sess.UploadedIndexes) != 0 {
		t.Fatalf("expected 3 chunks / empty indexes, got %+v", sess)
	}

	// 大小非法 / 超限 / 类型不支持 / 分组不匹配
	if _, err := s.Init(ctx, media.KindVideo, "a.mp4", 0, owner, 0); !errors.Is(err, ErrInvalidSize) {
		t.Fatalf("expected ErrInvalidSize, got %v", err)
	}
	if _, err := s.Init(ctx, media.KindImage, "a.png", tenMB+1, owner, 0); !errors.Is(err, media.ErrTooLarge) {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if _, err := s.Init(ctx, media.KindVideo, "a.txt", 1024, owner, 0); !errors.Is(err, media.ErrInvalidType) {
		t.Fatalf("expected ErrInvalidType, got %v", err)
	}
	if _, err := s.Init(ctx, media.KindVideo, "a.mp4", 1024, owner, 9999); !errors.Is(err, media.ErrInvalidGroup) {
		t.Fatalf("expected ErrInvalidGroup, got %v", err)
	}

	// 同类型分组放行
	group, err := mediaSvc.CreateGroup(ctx, media.KindVideo, "宣传片")
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	sess = mustInit(t, s, media.KindVideo, "a.mp4", 1024, owner, group.ID)
	if sess.ChunkCount != 1 {
		t.Fatalf("expected 1 chunk, got %d", sess.ChunkCount)
	}
}

func TestPutChunk(t *testing.T) {
	s, _, _, _ := newUploadService(t)
	sess := mustInit(t, s, media.KindVideo, "a.mp4", 12<<20, owner, 0)

	// 正常写入,内容与索引对应
	putChunk(t, s, sess.UploadID, 1, owner, testBytes(1024))
	got, err := os.ReadFile(filepath.Join(s.dir(sess.UploadID), chunkName(1)))
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}
	if string(got) != string(testBytes(1024)) {
		t.Fatal("chunk content mismatch")
	}

	// 索引越界(负数 / 超过 chunkCount)
	if err := s.PutChunk(sess.UploadID, -1, owner, bytesReader([]byte("x"))); !errors.Is(err, ErrInvalidIndex) {
		t.Fatalf("expected ErrInvalidIndex, got %v", err)
	}
	if err := s.PutChunk(sess.UploadID, sess.ChunkCount, owner, bytesReader([]byte("x"))); !errors.Is(err, ErrInvalidIndex) {
		t.Fatalf("expected ErrInvalidIndex, got %v", err)
	}

	// 单片超过 chunkSize
	big := make([]byte, ChunkSize+1)
	if err := s.PutChunk(sess.UploadID, 0, owner, bytesReader(big)); !errors.Is(err, ErrChunkTooLarge) {
		t.Fatalf("expected ErrChunkTooLarge, got %v", err)
	}

	// 重复上传同一分片幂等覆盖:状态只记一次,内容为新数据
	putChunk(t, s, sess.UploadID, 1, owner, []byte("new"))
	putChunk(t, s, sess.UploadID, 1, owner, []byte("newer"))
	status, err := s.Status(sess.UploadID, owner)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(status.UploadedIndexes) != 1 || status.UploadedIndexes[0] != 1 {
		t.Fatalf("expected [1], got %v", status.UploadedIndexes)
	}
	got, err = os.ReadFile(filepath.Join(s.dir(sess.UploadID), chunkName(1)))
	if err != nil || string(got) != "newer" {
		t.Fatalf("expected overwritten chunk, got %q, %v", got, err)
	}

	// 非属主写分片 → 404 语义(ErrSessionNotFound)
	if err := s.PutChunk(sess.UploadID, 0, other, bytesReader([]byte("x"))); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
	// 非法 uploadId(防目录穿越)→ ErrSessionNotFound
	if err := s.PutChunk("../escape", 0, owner, bytesReader([]byte("x"))); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
}

func TestComplete(t *testing.T) {
	s, _, db, store := newUploadService(t)
	ctx := context.Background()

	// 12MB 视频分 3 片,完整拼接后与原文件一致
	original := testBytes(12 << 20)
	sess := mustInit(t, s, media.KindVideo, "宣传片.mp4", int64(len(original)), owner, 0)
	putChunk(t, s, sess.UploadID, 0, owner, original[:fiveMB])
	putChunk(t, s, sess.UploadID, 1, owner, original[fiveMB:2*fiveMB])

	// 分片未齐全拒绝合并
	if _, err := s.Complete(ctx, sess.UploadID, owner); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("expected ErrIncomplete for missing chunk, got %v", err)
	}
	// 总大小不符拒绝(最后一片短传)
	putChunk(t, s, sess.UploadID, 2, owner, original[2*fiveMB:2*fiveMB+100])
	if _, err := s.Complete(ctx, sess.UploadID, owner); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("expected ErrIncomplete for size mismatch, got %v", err)
	}

	// 补齐后 complete:字节一致、落库、oplog 埋点、会话目录清理
	putChunk(t, s, sess.UploadID, 2, owner, original[2*fiveMB:])
	result, err := s.Complete(ctx, sess.UploadID, owner)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if result.Kind != media.KindVideo || result.OrigName != "宣传片.mp4" || result.Size != int64(len(original)) {
		t.Fatalf("unexpected result: %+v", result)
	}
	file, err := repo.GetFileByID(ctx, db, fileIDOf(t, db, result.ID))
	if err != nil {
		t.Fatalf("get file: %v", err)
	}
	stream, err := store.Open(ctx, file.Name)
	if err != nil {
		t.Fatalf("open stored file: %v", err)
	}
	stored := readAll(t, stream)
	_ = stream.Close()
	if string(stored) != string(original) {
		t.Fatalf("stored bytes differ from original (len %d vs %d)", len(stored), len(original))
	}
	if _, err := os.Stat(s.dir(sess.UploadID)); !os.IsNotExist(err) {
		t.Fatalf("session dir should be removed after complete, got %v", err)
	}
	if countLogs(t, db, "media.upload", oplog.StatusSuccess) != 1 {
		t.Fatal("expected 1 success media.upload log")
	}

	// complete 后会话已不存在,再操作 → ErrSessionNotFound
	if _, err := s.Status(sess.UploadID, owner); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound after complete, got %v", err)
	}
}

func TestCompleteImage(t *testing.T) {
	s, _, _, _ := newUploadService(t)
	ctx := context.Background()

	// 图片走同一会话协议(≤10MB):两片拼接
	original := testBytes(int(fiveMB) + 100)
	sess := mustInit(t, s, media.KindImage, "a.png", int64(len(original)), owner, 0)
	if sess.ChunkCount != 2 {
		t.Fatalf("expected 2 chunks, got %d", sess.ChunkCount)
	}
	putChunk(t, s, sess.UploadID, 0, owner, original[:fiveMB])
	putChunk(t, s, sess.UploadID, 1, owner, original[fiveMB:])
	result, err := s.Complete(ctx, sess.UploadID, owner)
	if err != nil {
		t.Fatalf("complete image: %v", err)
	}
	if result.Kind != media.KindImage || result.Size != int64(len(original)) {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestOwnerCheck(t *testing.T) {
	s, _, _, _ := newUploadService(t)
	sess := mustInit(t, s, media.KindVideo, "a.mp4", 1024, owner, 0)

	// 属主不匹配与不存在统一 ErrSessionNotFound(404,不泄露存在性)
	if _, err := s.Status(sess.UploadID, other); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
	if _, err := s.Complete(context.Background(), sess.UploadID, other); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
	if err := s.Abort(sess.UploadID, other); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound, got %v", err)
	}
	if _, err := s.Status("00000000-0000-0000-0000-000000000000", owner); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound for unknown id, got %v", err)
	}
	// 属主本人一切正常
	putChunk(t, s, sess.UploadID, 0, owner, []byte("data"))
	if _, err := s.Status(sess.UploadID, owner); err != nil {
		t.Fatalf("owner status should pass: %v", err)
	}
}

func TestAbort(t *testing.T) {
	s, _, _, _ := newUploadService(t)
	sess := mustInit(t, s, media.KindVideo, "a.mp4", 1024, owner, 0)
	putChunk(t, s, sess.UploadID, 0, owner, []byte("data"))

	if err := s.Abort(sess.UploadID, owner); err != nil {
		t.Fatalf("abort: %v", err)
	}
	if _, err := os.Stat(s.dir(sess.UploadID)); !os.IsNotExist(err) {
		t.Fatalf("session dir should be removed, got %v", err)
	}
	if _, err := s.Status(sess.UploadID, owner); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("expected ErrSessionNotFound after abort, got %v", err)
	}
}

func TestCleanupExpired(t *testing.T) {
	s, _, _, _ := newUploadService(t)

	stale := mustInit(t, s, media.KindVideo, "old.mp4", 1024, owner, 0)
	fresh := mustInit(t, s, media.KindVideo, "new.mp4", 1024, owner, 0)

	// 把 stale 的 createdAt 回拨到 TTL 之前
	deadline := time.Now().Add(-SessionTTL - time.Hour)
	if err := s.saveMeta(stale.UploadID, meta{
		Kind: media.KindVideo, FileName: "old.mp4", Size: 1024,
		ChunkSize: ChunkSize, ChunkCount: 1, UploaderID: owner, CreatedAt: deadline,
	}); err != nil {
		t.Fatalf("backdate meta: %v", err)
	}

	if removed := s.CleanupExpired(); removed != 1 {
		t.Fatalf("expected 1 removed, got %d", removed)
	}
	if _, err := os.Stat(s.dir(stale.UploadID)); !os.IsNotExist(err) {
		t.Fatalf("stale session should be removed, got %v", err)
	}
	if _, err := s.Status(fresh.UploadID, owner); err != nil {
		t.Fatalf("fresh session should survive: %v", err)
	}
}

// ---- 测试辅助 ----

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

// fileIDOf 媒体资源对应的底层文件 ID。
func fileIDOf(t *testing.T, db *gorm.DB, assetID int64) int64 {
	t.Helper()
	asset, err := repo.GetMediaAssetByID(context.Background(), db, assetID)
	if err != nil {
		t.Fatalf("get asset: %v", err)
	}
	return asset.FileID
}

func readAll(t *testing.T, r io.Reader) []byte {
	t.Helper()
	data, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return data
}

func countLogs(t *testing.T, db *gorm.DB, action, status string) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&repo.OperationLog{}).Where("action = ? AND status = ?", action, status).Count(&count).Error; err != nil {
		t.Fatalf("count logs: %v", err)
	}
	return count
}
