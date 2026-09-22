package repo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// ErrDictNotFound 字典不存在。
var ErrDictNotFound = errors.New("dict not found")

// ErrDictEntryNotFound 字典项不存在。
var ErrDictEntryNotFound = errors.New("dict entry not found")

func ListDicts(ctx context.Context, db *gorm.DB, keyword string) ([]Dict, error) {
	query := db.WithContext(ctx).Model(&Dict{})
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("code LIKE ? OR name LIKE ?", like, like)
	}
	var dicts []Dict
	if err := query.Order("id ASC").Find(&dicts).Error; err != nil {
		return nil, fmt.Errorf("list dicts: %w", err)
	}
	return dicts, nil
}

// GetDictByID 按主键查字典。

func GetDictByID(ctx context.Context, db *gorm.DB, id int64) (Dict, error) {
	var dict Dict
	err := db.WithContext(ctx).First(&dict, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Dict{}, ErrDictNotFound
	}
	if err != nil {
		return Dict{}, fmt.Errorf("get dict by id: %w", err)
	}
	return dict, nil
}

// GetDictByCode 按编码查字典。

func GetDictByCode(ctx context.Context, db *gorm.DB, code string) (Dict, error) {
	var dict Dict
	err := db.WithContext(ctx).Where("code = ?", code).First(&dict).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Dict{}, ErrDictNotFound
	}
	if err != nil {
		return Dict{}, fmt.Errorf("get dict by code: %w", err)
	}
	return dict, nil
}

// CreateDict 新建字典。

func CreateDict(ctx context.Context, db *gorm.DB, dict *Dict) error {
	if err := db.WithContext(ctx).Create(dict).Error; err != nil {
		return fmt.Errorf("create dict: %w", err)
	}
	return nil
}

// UpdateDict 更新字典。

func UpdateDict(ctx context.Context, db *gorm.DB, dict *Dict) error {
	if err := db.WithContext(ctx).Save(dict).Error; err != nil {
		return fmt.Errorf("update dict: %w", err)
	}
	return nil
}

// DeleteDict 删除字典并级联删除字典项。

func DeleteDict(ctx context.Context, db *gorm.DB, dictID int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("dict_id = ?", dictID).Delete(&DictEntry{}).Error; err != nil {
			return fmt.Errorf("delete dict entries: %w", err)
		}
		if err := tx.Delete(&Dict{}, dictID).Error; err != nil {
			return fmt.Errorf("delete dict: %w", err)
		}
		return nil
	})
}

// ListDictEntriesByDictID 字典项列表(按 sort、id 排序)。

func ListDictEntriesByDictID(ctx context.Context, db *gorm.DB, dictID int64) ([]DictEntry, error) {
	var entries []DictEntry
	if err := db.WithContext(ctx).Where("dict_id = ?", dictID).
		Order("sort ASC, id ASC").Find(&entries).Error; err != nil {
		return nil, fmt.Errorf("list dict entries: %w", err)
	}
	return entries, nil
}

// GetDictEntryByID 按主键查字典项。

func GetDictEntryByID(ctx context.Context, db *gorm.DB, id int64) (DictEntry, error) {
	var entry DictEntry
	err := db.WithContext(ctx).First(&entry, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DictEntry{}, ErrDictEntryNotFound
	}
	if err != nil {
		return DictEntry{}, fmt.Errorf("get dict entry by id: %w", err)
	}
	return entry, nil
}

// HasDictEntryValue 同字典内是否存在相同 value(唯一守卫;excludeID 用于更新场景)。

func HasDictEntryValue(ctx context.Context, db *gorm.DB, dictID int64, value string, excludeID int64) (bool, error) {
	var count int64
	query := db.WithContext(ctx).Model(&DictEntry{}).
		Where("dict_id = ? AND value = ?", dictID, value)
	if excludeID != 0 {
		query = query.Where("id != ?", excludeID)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, fmt.Errorf("count dict entry value: %w", err)
	}
	return count > 0, nil
}

// CreateDictEntry 新建字典项。

func CreateDictEntry(ctx context.Context, db *gorm.DB, entry *DictEntry) error {
	if err := db.WithContext(ctx).Create(entry).Error; err != nil {
		return fmt.Errorf("create dict entry: %w", err)
	}
	return nil
}

// UpdateDictEntry 更新字典项。

func UpdateDictEntry(ctx context.Context, db *gorm.DB, entry *DictEntry) error {
	if err := db.WithContext(ctx).Save(entry).Error; err != nil {
		return fmt.Errorf("update dict entry: %w", err)
	}
	return nil
}

// ReplaceDictEntries 整组覆写字典项(事务内先删后插,编辑弹窗一次保存)。
func ReplaceDictEntries(ctx context.Context, db *gorm.DB, dictID int64, entries []DictEntry) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("dict_id = ?", dictID).Delete(&DictEntry{}).Error; err != nil {
			return fmt.Errorf("clear dict entries: %w", err)
		}
		for i := range entries {
			entries[i].DictID = dictID
			if err := tx.Create(&entries[i]).Error; err != nil {
				return fmt.Errorf("insert dict entry: %w", err)
			}
		}
		return nil
	})
}

// DeleteDictEntry 删除字典项。

func DeleteDictEntry(ctx context.Context, db *gorm.DB, id int64) error {
	if err := db.WithContext(ctx).Delete(&DictEntry{}, id).Error; err != nil {
		return fmt.Errorf("delete dict entry: %w", err)
	}
	return nil
}
