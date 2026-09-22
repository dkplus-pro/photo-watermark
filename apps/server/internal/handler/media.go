package handler

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/media"
)

// MediaHandler Media资源处理器,只注入本资源所需依赖。
type MediaHandler struct {
	logger *slog.Logger
	media  *media.Service
}

// 媒体 kind → 上传/列表操作名(kind 本身即路由语义,handler 按方法分派)。

// UploadImage POST /images。
func (h *MediaHandler) UploadImage(w http.ResponseWriter, r *http.Request) {
	h.uploadMedia(w, r, media.KindImage)
}

// ListImages GET /images。
func (h *MediaHandler) ListImages(w http.ResponseWriter, r *http.Request, params gen.ListImagesParams) {
	h.listMedia(w, r, media.KindImage, params.GroupId, params.Page, params.PageSize)
}

// GetImage GET /images/{id}。
func (h *MediaHandler) GetImage(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.getMedia(w, r, int64(id))
}

// DeleteImage DELETE /images/{id}。
func (h *MediaHandler) DeleteImage(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.deleteMedia(w, r, int64(id))
}

// UploadVideo POST /videos。
func (h *MediaHandler) UploadVideo(w http.ResponseWriter, r *http.Request) {
	h.uploadMedia(w, r, media.KindVideo)
}

// ListVideos GET /videos。
func (h *MediaHandler) ListVideos(w http.ResponseWriter, r *http.Request, params gen.ListVideosParams) {
	h.listMedia(w, r, media.KindVideo, params.GroupId, params.Page, params.PageSize)
}

// GetVideo GET /videos/{id}。
func (h *MediaHandler) GetVideo(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.getMedia(w, r, int64(id))
}

// DeleteVideo DELETE /videos/{id}。
func (h *MediaHandler) DeleteVideo(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.deleteMedia(w, r, int64(id))
}

// uploadMedia multipart 上传(kind 决定类型校验与大小上限;groupId 可选,0=未分组)。
func (h *MediaHandler) uploadMedia(w http.ResponseWriter, r *http.Request, kind string) {
	claims, _ := httpapi.ClaimsFromContext(r.Context())

	file, header, err := r.FormFile("file")
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "缺少上传文件")
		return
	}
	defer file.Close()

	groupID := int64(0)
	if raw := r.FormValue("groupId"); raw != "" {
		groupID, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || groupID < 0 {
			httpapi.WriteError(w, http.StatusBadRequest, "分组参数不合法")
			return
		}
	}

	asset, err := h.media.Upload(r.Context(), kind, header.Filename, header.Header.Get("Content-Type"), file, claims.UserID, groupID)
	switch {
	case errors.Is(err, media.ErrInvalidType):
		httpapi.WriteError(w, http.StatusBadRequest, "不支持的文件类型")
		return
	case errors.Is(err, media.ErrTooLarge):
		httpapi.WriteError(w, http.StatusBadRequest, "文件超过大小限制")
		return
	case err != nil:
		h.logger.Error("upload media", "kind", kind, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if kind == media.KindVideo {
		httpapi.WriteJSON(w, http.StatusOK, toGenVideo(asset))
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenImage(asset))
}

// listMedia 分页列表(groupID nil=全部,0=未分组,>0=指定分组)。
func (h *MediaHandler) listMedia(w http.ResponseWriter, r *http.Request, kind string, groupID *int64, page, pageSize *gen.Page) {
	p, ps := pageParams(page, pageSize)
	assets, total, err := h.media.List(r.Context(), kind, groupID, p, ps)
	if err != nil {
		h.logger.Error("list media", "kind", kind, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if kind == media.KindVideo {
		videos := make([]gen.VideoAsset, 0, len(assets))
		for _, asset := range assets {
			videos = append(videos, toGenVideo(asset))
		}
		httpapi.WriteJSON(w, http.StatusOK, gen.VideoListResponse{List: videos, Total: int(total)})
		return
	}
	images := make([]gen.ImageAsset, 0, len(assets))
	for _, asset := range assets {
		images = append(images, toGenImage(asset))
	}
	httpapi.WriteJSON(w, http.StatusOK, gen.ImageListResponse{List: images, Total: int(total)})
}

// getMedia 详情。
func (h *MediaHandler) getMedia(w http.ResponseWriter, r *http.Request, id int64) {
	asset, err := h.media.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, media.ErrMediaNotFound) {
			httpapi.WriteError(w, http.StatusNotFound, "资源不存在")
			return
		}
		h.logger.Error("get media", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenImage(asset))
}

// deleteMedia 删除(级联底层文件)。
func (h *MediaHandler) deleteMedia(w http.ResponseWriter, r *http.Request, id int64) {
	err := h.media.Delete(r.Context(), id)
	switch {
	case errors.Is(err, media.ErrMediaNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "资源不存在")
		return
	case err != nil:
		h.logger.Error("delete media", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// GetFileContent GET /files/{id}/content:文件内容(图片预览/视频播放共用;登录即可)。
// OSS 记录(files.url 非空)302 到 CDN 直链;local 记录流式输出并保留 Range。
func (h *MediaHandler) GetFileContent(w http.ResponseWriter, r *http.Request, id gen.Id) {
	file, err := h.media.GetFile(r.Context(), int64(id))
	if err != nil {
		if errors.Is(err, media.ErrMediaNotFound) {
			httpapi.WriteError(w, http.StatusNotFound, "文件不存在")
			return
		}
		h.logger.Error("get file content", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if file.Url != "" {
		http.Redirect(w, r, file.Url, http.StatusFound)
		return
	}

	stream, err := h.media.Open(r.Context(), file.Name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			httpapi.WriteError(w, http.StatusNotFound, "文件不存在")
			return
		}
		h.logger.Error("open file content", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", file.Mime)
	w.Header().Set("Content-Length", strconv.FormatInt(file.Size, 10))
	if seeker, ok := stream.(io.ReadSeeker); ok {
		http.ServeContent(w, r, file.OrigName, file.CreatedAt, seeker)
		return
	}
	_, _ = io.Copy(w, stream)
}

// toGenImage / toGenVideo:富化后的媒体资源 → 契约生成物。
func toGenImage(asset media.Asset) gen.ImageAsset {
	var width, height *int
	var format *string
	if asset.Width > 0 {
		width = &asset.Width
	}
	if asset.Height > 0 {
		height = &asset.Height
	}
	if asset.Format != "" {
		format = &asset.Format
	}
	return gen.ImageAsset{
		Id:        asset.ID,
		FileId:    asset.FileID,
		Title:     asset.Title,
		OrigName:  asset.OrigName,
		Size:      asset.Size,
		Width:     width,
		Height:    height,
		Format:    format,
		Url:       asset.URL,
		GroupId:   asset.GroupID,
		GroupName: asset.GroupName,
		CreatedAt: asset.CreatedAt,
	}
}

func toGenVideo(asset media.Asset) gen.VideoAsset {
	return gen.VideoAsset{
		Id:        asset.ID,
		FileId:    asset.FileID,
		Title:     asset.Title,
		OrigName:  asset.OrigName,
		Size:      asset.Size,
		Url:       asset.URL,
		GroupId:   asset.GroupID,
		GroupName: asset.GroupName,
		CreatedAt: asset.CreatedAt,
		// durationSeconds / resolution 预留,待 ffprobe 接入后填充
	}
}
