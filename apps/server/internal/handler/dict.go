package handler

import (
	"errors"
	"log/slog"
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/service"
	"github.com/cms-template/server/internal/types"
)

// DictsHandler Dicts资源处理器,只注入本资源所需依赖。
type DictsHandler struct {
	logger *slog.Logger
	dicts  *service.DictService
}

func toGenDict(dict types.Dict) gen.Dict {
	return gen.Dict{
		Id:     dict.ID,
		Code:   dict.Code,
		Name:   dict.Name,
		Remark: genOptsString(dict.Remark),
		Status: dict.Status,
	}
}

func toGenDictEntry(entry types.DictEntry) gen.DictEntry {
	return gen.DictEntry{
		Id:     entry.ID,
		DictId: entry.DictID,
		Label:  entry.Label,
		Value:  entry.Value,
		Sort:   entry.Sort,
		Status: entry.Status,
	}
}

// GetConfig GET /configs/{group}。

func (h *DictsHandler) ListDicts(w http.ResponseWriter, r *http.Request, params gen.ListDictsParams) {
	items, err := h.dicts.List(r.Context(), derefString(params.Keyword))
	if err != nil {
		h.logger.Error("list dicts", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	list := make([]gen.Dict, 0, len(items))
	for _, dict := range items {
		list = append(list, toGenDict(dict))
	}
	httpapi.WriteJSON(w, http.StatusOK, list)
}

// CreateDict POST /dicts。

func (h *DictsHandler) CreateDict(w http.ResponseWriter, r *http.Request) {
	var req gen.DictUpsertRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	dict, err := h.dicts.Create(r.Context(), req.Code, req.Name, derefString(req.Remark), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrDictCodeExists):
		httpapi.WriteError(w, http.StatusConflict, "字典编码已存在")
		return
	case err != nil:
		h.logger.Error("create dict", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenDict(dict))
}

// UpdateDict PUT /dicts/{id}。

func (h *DictsHandler) UpdateDict(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.DictUpsertRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	dict, err := h.dicts.Update(r.Context(), int64(id), req.Code, req.Name, derefString(req.Remark), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrDictCodeExists):
		httpapi.WriteError(w, http.StatusConflict, "字典编码已存在")
		return
	case errors.Is(err, service.ErrDictNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
		return
	case err != nil:
		h.logger.Error("update dict", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenDict(dict))
}

// DeleteDict DELETE /dicts/{id}。

func (h *DictsHandler) DeleteDict(w http.ResponseWriter, r *http.Request, id gen.Id) {
	err := h.dicts.Delete(r.Context(), int64(id))
	switch {
	case errors.Is(err, service.ErrDictNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
		return
	case err != nil:
		h.logger.Error("delete dict", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// UpdateDictStatus PATCH /dicts/{id}/status。
func (h *DictsHandler) UpdateDictStatus(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.StatusRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}
	err := h.dicts.UpdateStatus(r.Context(), int64(id), req.Status)
	switch {
	case errors.Is(err, service.ErrDictNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
		return
	case err != nil:
		h.logger.Error("update dict status", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// ReplaceDictEntries PUT /dicts/{id}/entries。
func (h *DictsHandler) ReplaceDictEntries(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.DictEntriesRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}
	entries := make([]types.DictEntry, 0, len(req.Entries))
	for _, e := range req.Entries {
		entries = append(entries, types.DictEntry{
			Label: e.Label, Value: e.Value, Sort: derefInt(e.Sort), Status: derefBoolDefault(e.Status, true),
		})
	}
	err := h.dicts.ReplaceEntries(r.Context(), int64(id), entries)
	switch {
	case errors.Is(err, service.ErrDictNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
		return
	case err != nil:
		h.logger.Error("replace dict entries", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// ListDictItems GET /dicts/{code}/items。

func (h *DictsHandler) ListDictItems(w http.ResponseWriter, r *http.Request, code string) {
	items, err := h.dicts.ListEntries(r.Context(), code)
	if err != nil {
		if errors.Is(err, service.ErrDictNotFound) {
			httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
			return
		}
		h.logger.Error("list dict items", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	list := make([]gen.DictEntry, 0, len(items))
	for _, entry := range items {
		list = append(list, toGenDictEntry(entry))
	}
	httpapi.WriteJSON(w, http.StatusOK, list)
}

// CreateDictItem POST /dicts/{code}/items。

func (h *DictsHandler) CreateDictItem(w http.ResponseWriter, r *http.Request, code string) {
	var req gen.DictEntryUpsertRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	entry, err := h.dicts.CreateEntry(r.Context(), code, req.Label, req.Value, derefInt(req.Sort), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrDictValueExists):
		httpapi.WriteError(w, http.StatusConflict, "字典项值重复")
		return
	case errors.Is(err, service.ErrDictNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典不存在")
		return
	case err != nil:
		h.logger.Error("create dict item", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenDictEntry(entry))
}

// UpdateDictItem PUT /dicts/{code}/items/{itemId}。
func (h *DictsHandler) UpdateDictItem(w http.ResponseWriter, r *http.Request, code string, itemId int64) {
	var req gen.DictEntryUpsertRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	entry, err := h.dicts.UpdateEntry(r.Context(), itemId, req.Label, req.Value, derefInt(req.Sort), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrDictValueExists):
		httpapi.WriteError(w, http.StatusConflict, "字典项值重复")
		return
	case errors.Is(err, service.ErrDictEntryNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典项不存在")
		return
	case err != nil:
		h.logger.Error("update dict item", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenDictEntry(entry))
}

// DeleteDictItem DELETE /dicts/{code}/items/{itemId}。
func (h *DictsHandler) DeleteDictItem(w http.ResponseWriter, r *http.Request, code string, itemId int64) {
	err := h.dicts.DeleteEntry(r.Context(), itemId)
	switch {
	case errors.Is(err, service.ErrDictEntryNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "字典项不存在")
		return
	case err != nil:
		h.logger.Error("delete dict item", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}
