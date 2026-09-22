package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	cos "github.com/tencentyun/cos-go-sdk-v5"
)

// COSConfig 腾讯云 COS 连接配置;含义见 internal/config 的环境变量说明。
type COSConfig struct {
	SecretID  string
	SecretKey string
	Bucket    string // 全名,含 -APPID 后缀
	Region    string
	CDNDomain string // 为空时用默认 {bucket}.cos.{region}.myqcloud.com
	Prefix    string // 对象 key 前缀,可空;非空时自动补尾部 "/"
}

// COS 腾讯云对象存储实现;对象 key = prefix + uuid + 扩展名。
type COS struct {
	client    *cos.Client
	cdnDomain string
	prefix    string
}

// NewCOS 构造 COS 存储;cfg 必填项已在 config 加载时校验。
func NewCOS(cfg COSConfig) (*COS, error) {
	base, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", cfg.Bucket, cfg.Region))
	if err != nil {
		return nil, fmt.Errorf("invalid cos bucket/region: %w", err)
	}
	client := cos.NewClient(&cos.BaseURL{BucketURL: base}, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  cfg.SecretID,
			SecretKey: cfg.SecretKey,
		},
	})
	cdnDomain := strings.TrimRight(cfg.CDNDomain, "/")
	if cdnDomain == "" {
		cdnDomain = fmt.Sprintf("https://%s.cos.%s.myqcloud.com", cfg.Bucket, cfg.Region)
	}
	prefix := strings.TrimLeft(cfg.Prefix, "/")
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	return &COS{client: client, cdnDomain: cdnDomain, prefix: prefix}, nil
}

// Save 流式上传对象;不可寻址的 reader 先落临时文件,COS 需要确定 Content-Length。
func (c *COS) Save(ctx context.Context, r io.Reader, ext string) (string, int64, error) {
	name, err := newName(ext)
	if err != nil {
		return "", 0, err
	}
	key := c.prefix + name

	body, size, cleanup, err := seekableBody(r)
	if err != nil {
		return "", 0, err
	}
	defer cleanup()

	if _, err := c.client.Object.Put(ctx, key, body, nil); err != nil {
		return "", 0, fmt.Errorf("cos put %s: %w", key, err)
	}
	return key, size, nil
}

// Open 顺序读对象内容;对象不存在映射为 os.ErrNotExist。
func (c *COS) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	resp, err := c.client.Object.Get(ctx, key, nil)
	if err != nil {
		if isCosNotFound(err) {
			return nil, fmt.Errorf("%w: %s", os.ErrNotExist, key)
		}
		return nil, fmt.Errorf("cos get %s: %w", key, err)
	}
	return resp.Body, nil
}

// URL 返回 CDN 直链(未配 CDN 域名时为 COS 默认域名直链)。
func (c *COS) URL(key string) string {
	return c.cdnDomain + "/" + key
}

// Driver 驱动名。
func (c *COS) Driver() string { return "cos" }

// Delete 删除对象;COS 对缺失 key 的删除返回成功,天然幂等。
func (c *COS) Delete(ctx context.Context, key string) error {
	if _, err := c.client.Object.Delete(ctx, key); err != nil && !isCosNotFound(err) {
		return fmt.Errorf("cos delete %s: %w", key, err)
	}
	return nil
}

// seekableBody 返回可寻址的 body 与字节数;reader 本身可寻址则直接用,否则落临时文件。
func seekableBody(r io.Reader) (io.ReadSeeker, int64, func(), error) {
	if rs, ok := r.(io.ReadSeeker); ok {
		size, err := rs.Seek(0, io.SeekEnd)
		if err != nil {
			return nil, 0, nil, fmt.Errorf("seek body: %w", err)
		}
		if _, err := rs.Seek(0, io.SeekStart); err != nil {
			return nil, 0, nil, fmt.Errorf("rewind body: %w", err)
		}
		return rs, size, func() {}, nil
	}

	tmp, err := os.CreateTemp("", "cos-upload-*")
	if err != nil {
		return nil, 0, nil, fmt.Errorf("create spool file: %w", err)
	}
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}
	size, err := io.Copy(tmp, r)
	if err != nil {
		cleanup()
		return nil, 0, nil, fmt.Errorf("spool body: %w", err)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, nil, fmt.Errorf("rewind spool file: %w", err)
	}
	return tmp, size, cleanup, nil
}

// isCosNotFound 判断 COS 错误是否为对象不存在(404 / NoSuchKey)。
func isCosNotFound(err error) bool {
	var resp *cos.ErrorResponse
	if errors.As(err, &resp) {
		return resp.Code == "NoSuchKey" ||
			(resp.Response != nil && resp.Response.StatusCode == http.StatusNotFound)
	}
	return false
}
