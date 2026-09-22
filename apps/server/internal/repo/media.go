package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ErrFileNotFound 底层文件记录不存在。
var ErrFileNotFound = errors.New("file not found")

// File 底层文件记录(通用,与媒体类型无关;见 docs/database.md)。
type File struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	OrigName   string    `gorm:"size:255;not null" json:"origName"`
	Name       string    `gorm:"size:128;not null;uniqueIndex" json:"name"`
	Path       string    `gorm:"size:255;not null" json:"path"`
	Mime       string    `gorm:"size:64" json:"mime"`
	Size       int64     `gorm:"not null" json:"size"`
	Storage    string    `gorm:"size:16;not null;default:local" json:"storage"`
	Url        string    `gorm:"size:512;not null;default:''" json:"url"`
	UploaderID int64     `gorm:"not null;default:0" json:"uploaderId"`
	CreatedAt  time.Time `gorm:"not null" json:"createdAt"`
}

func (File) TableName() string { return "files" }

// MediaAsset 媒体资源(类型化上层)。
type MediaAsset struct {
	ID         int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Kind       string    `gorm:"size:16;not null;index" json:"kind"`
	FileID     int64     `gorm:"not null" json:"fileId"`
	Title      string    `gorm:"size:255;not null" json:"title"`
	Meta       string    `gorm:"type:text" json:"meta"`
	GroupID    int64     `gorm:"not null;default:0;index" json:"groupId"` // 所属分组,0=未分组
	UploaderID int64     `gorm:"not null;default:0" json:"uploaderId"`
	CreatedAt  time.Time `gorm:"not null" json:"createdAt"`
	UpdatedAt  time.Time `gorm:"not null" json:"updatedAt"`
}

func (MediaAsset) TableName() string { return "media_assets" }

// CreateFile 新建底层文件记录。
func CreateFile(ctx context.Context, db *gorm.DB, file *File) error {
	if err := db.WithContext(ctx).Create(file).Error; err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	return nil
}

// GetFileByID 按主键查文件记录。
func GetFileByID(ctx context.Context, db *gorm.DB, id int64) (File, error) {
	var file File
	err := db.WithContext(ctx).First(&file, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return File{}, ErrFileNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("get file by id: %w", err)
	}
	return file, nil
}

// DeleteFile 删除底层文件记录(介质删除由 service 层先行)。
func DeleteFile(ctx context.Context, db *gorm.DB, id int64) error {
	if err := db.WithContext(ctx).Delete(&File{}, id).Error; err != nil {
		return fmt.Errorf("delete file: %w", err)
	}
	return nil
}

// CreateMediaAsset 新建媒体资源。
func CreateMediaAsset(ctx context.Context, db *gorm.DB, asset *MediaAsset) error {
	if err := db.WithContext(ctx).Create(asset).Error; err != nil {
		return fmt.Errorf("create media asset: %w", err)
	}
	return nil
}

// GetMediaAssetByID 按主键查媒体资源。
func GetMediaAssetByID(ctx context.Context, db *gorm.DB, id int64) (MediaAsset, error) {
	var asset MediaAsset
	err := db.WithContext(ctx).First(&asset, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MediaAsset{}, ErrFileNotFound
	}
	if err != nil {
		return MediaAsset{}, fmt.Errorf("get media asset by id: %w", err)
	}
	return asset, nil
}

// ListMediaAssets 媒体资源分页(按 kind;groupID nil=全部,0=未分组,>0=指定分组)。
func ListMediaAssets(ctx context.Context, db *gorm.DB, kind string, groupID *int64, page, pageSize int) ([]MediaAsset, int64, error) {
	query := db.WithContext(ctx).Model(&MediaAsset{}).Where("kind = ?", kind)
	if groupID != nil {
		query = query.Where("group_id = ?", *groupID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count media assets: %w", err)
	}

	var assets []MediaAsset
	if err := query.Order("id DESC").
		Limit(pageSize).Offset((page - 1) * pageSize).
		Find(&assets).Error; err != nil {
		return nil, 0, fmt.Errorf("list media assets: %w", err)
	}
	return assets, total, nil
}

// DeleteMediaAsset 删除媒体资源记录(底层文件由 service 层处理)。
func DeleteMediaAsset(ctx context.Context, db *gorm.DB, id int64) error {
	if err := db.WithContext(ctx).Delete(&MediaAsset{}, id).Error; err != nil {
		return fmt.Errorf("delete media asset: %w", err)
	}
	return nil
}
