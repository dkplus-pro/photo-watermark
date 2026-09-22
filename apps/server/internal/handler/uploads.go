package handler

import (
	"errors"
	"log/slog"
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/media"
	"github.com/cms-template/server/internal/uploads"
)

// UploadsHandler Uploads资源处理器,只注入本资源所需依赖。
type UploadsHandler struct {
	logger  *slog.Logger
	uploads *uploads.Service
}

// 分片上传:权限校验只在初始化端点(注册表静态绑定 media:image:upload /
// media:video:upload),后续分片/状态/合并/中止仅要求登录 + 会话属主
// (属主不匹配与不存在统一 404,不泄露会话存在性)。

// InitImageUpload POST /api/admin/uploads/images。
func (h *UploadsHandler) InitImageUpload(w http.ResponseWriter, r *http.Request) {
	h.initUpload(w, r, media.KindImage)
}

// InitVideoUpload POST /api/admin/uploads/videos。
func (h *UploadsHandler) InitVideoUpload(w http.ResponseWriter, r *http.Request) {
	h.initUpload(w, r, media.KindVideo)
}

// initUpload 初始化分片上传会话(kind 决定类型校验与大小上限)。
func (h *UploadsHandler) initUpload(w http.ResponseWriter, r *http.Request, kind string) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	var req gen.InitUploadRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "请求参数不合法")
		return
	}
	groupID := int64(0)
	if req.GroupId != nil {
		groupID = *req.GroupId
	}

	sess, err := h.uploads.Init(r.Context(), kind, req.FileName, req.Size, claims.UserID, groupID)
	switch {
	case errors.Is(err, media.ErrInvalidType):
		httpapi.WriteError(w, http.StatusBadRequest, "不支持的文件类型")
	case errors.Is(err, media.ErrTooLarge):
		httpapi.WriteError(w, http.StatusBadRequest, "文件超过大小限制")
	case errors.Is(err, uploads.ErrInvalidSize):
		httpapi.WriteError(w, http.StatusBadRequest, "文件大小不合法")
	case errors.Is(err, media.ErrInvalidGroup):
		httpapi.WriteError(w, http.StatusBadRequest, "分组不存在或类型不匹配")
	case err != nil:
		h.logger.Error("init upload session", "kind", kind, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
	default:
		httpapi.WriteJSON(w, http.StatusOK, toGenUploadSession(sess))
	}
}

// UploadChunk PUT /api/admin/uploads/{uploadId}/chunks/{index}:octet-stream 分片。
func (h *UploadsHandler) UploadChunk(w http.ResponseWriter, r *http.Request, uploadId string, index int) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	err := h.uploads.PutChunk(uploadId, index, claims.UserID, r.Body)
	switch {
	case errors.Is(err, uploads.ErrSessionNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "会话不存在")
	case errors.Is(err, uploads.ErrInvalidIndex):
		httpapi.WriteError(w, http.StatusBadRequest, "分片索引越界")
	case errors.Is(err, uploads.ErrChunkTooLarge):
		httpapi.WriteError(w, http.StatusBadRequest, "单片超过大小限制")
	case err != nil:
		h.logger.Error("upload chunk", "uploadId", uploadId, "index", index, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
	default:
		httpapi.WriteJSON(w, http.StatusNoContent, nil)
	}
}

// GetUploadSession GET /api/admin/uploads/{uploadId}:会话状态(断点续传)。
func (h *UploadsHandler) GetUploadSession(w http.ResponseWriter, r *http.Request, uploadId string) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	sess, err := h.uploads.Status(uploadId, claims.UserID)
	if errors.Is(err, uploads.ErrSessionNotFound) {
		httpapi.WriteError(w, http.StatusNotFound, "会话不存在")
		return
	}
	if err != nil {
		h.logger.Error("get upload session", "uploadId", uploadId, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenUploadSession(sess))
}

// CompleteUpload POST /api/admin/uploads/{uploadId}/complete:合并并走媒体上传管线。
func (h *UploadsHandler) CompleteUpload(w http.ResponseWriter, r *http.Request, uploadId string) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	result, err := h.uploads.Complete(r.Context(), uploadId, claims.UserID)
	switch {
	case errors.Is(err, uploads.ErrSessionNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "会话不存在")
	case errors.Is(err, uploads.ErrIncomplete):
		httpapi.WriteError(w, http.StatusBadRequest, "分片不齐全或总大小不符")
	case errors.Is(err, media.ErrInvalidType):
		httpapi.WriteError(w, http.StatusBadRequest, "不支持的文件类型")
	case errors.Is(err, media.ErrTooLarge):
		httpapi.WriteError(w, http.StatusBadRequest, "文件超过大小限制")
	case err != nil:
		h.logger.Error("complete upload", "uploadId", uploadId, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
	default:
		httpapi.WriteJSON(w, http.StatusOK, gen.UploadedMedia{
			Id:       result.ID,
			Kind:     gen.UploadedMediaKind(result.Kind),
			Url:      result.URL,
			OrigName: result.OrigName,
			Size:     result.Size,
		})
	}
}

// AbortUpload DELETE /api/admin/uploads/{uploadId}:中止并清理会话。
func (h *UploadsHandler) AbortUpload(w http.ResponseWriter, r *http.Request, uploadId string) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	err := h.uploads.Abort(uploadId, claims.UserID)
	switch {
	case errors.Is(err, uploads.ErrSessionNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "会话不存在")
	case err != nil:
		h.logger.Error("abort upload", "uploadId", uploadId, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
	default:
		httpapi.WriteJSON(w, http.StatusNoContent, nil)
	}
}

// toGenUploadSession 会话业务出参 → 契约生成物。
func toGenUploadSession(sess uploads.Session) gen.UploadSession {
	return gen.UploadSession{
		UploadId:        sess.UploadID,
		Kind:            gen.UploadSessionKind(sess.Kind),
		FileName:        sess.FileName,
		Size:            sess.Size,
		ChunkSize:       sess.ChunkSize,
		ChunkCount:      sess.ChunkCount,
		UploadedIndexes: sess.UploadedIndexes,
	}
}
