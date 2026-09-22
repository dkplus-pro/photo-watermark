// Package service 承载业务规则。本文件:C 端版本检查(env 驱动,无 repo,GET 查询不埋 oplog)。
package service

import (
	"fmt"
	"strconv"
	"strings"
)

// VersionPlatform 目标平台(枚举即契约;handler 负责字符串解析与 400 映射)。
type VersionPlatform string

const (
	VersionPlatformIOS     VersionPlatform = "ios"
	VersionPlatformAndroid VersionPlatform = "android"
)

// ParseVersionPlatform 解析 query platform;非法返回 false(handler 映射 400)。
func ParseVersionPlatform(raw string) (VersionPlatform, bool) {
	switch VersionPlatform(raw) {
	case VersionPlatformIOS, VersionPlatformAndroid:
		return VersionPlatform(raw), true
	default:
		return "", false
	}
}

// VersionRule 单平台版本规则(零值合法:Latest 空 = 未配置)。
type VersionRule struct {
	Latest       string
	ForceBelow   string
	DownloadURL  string
	ReleaseNotes string
}

// VersionServiceConfig 双平台规则。
type VersionServiceConfig struct {
	IOS     VersionRule
	Android VersionRule
}

// VersionCheckOutcome 检查结果(服务自有类型,handler 映射到 gen DTO;service 不 import gen)。
type VersionCheckOutcome struct {
	HasUpdate     bool
	ForceUpdate   bool
	LatestVersion string
	DownloadURL   string
	ReleaseNotes  string
}

// VersionService 版本检查:纯内存规则,无 DB。
// service 禁止 import config(依赖矩阵),故规则以纯值构造参数传入,main.go 做 cfg→VersionServiceConfig 映射。
type VersionService struct {
	cfg VersionServiceConfig
}

// NewVersionService 以纯值规则构造版本检查服务(env 配置由 main.go 从 config 映射而来)。
func NewVersionService(cfg VersionServiceConfig) *VersionService {
	return &VersionService{cfg: cfg}
}

// Check 决策(全程不返回 error,零值/非法输入一律降级为「无更新」,避免坏 dart-define
// 把全量用户挡在强制更新外):
//  1. Latest 空 → 零值 Outcome,LatestVersion 回显 current;
//  2. current 非法(CompareVersions 报错)→ HasUpdate=false,LatestVersion 仍返回 Latest;
//  3. current < Latest → HasUpdate=true;再判 ForceBelow 非空且 current < ForceBelow → ForceUpdate=true;
//  4. DownloadURL/ReleaseNotes 按平台规则原样透传(未配置为空串)。
func (s *VersionService) Check(platform VersionPlatform, current string) VersionCheckOutcome {
	rule := s.cfg.IOS
	if platform == VersionPlatformAndroid {
		rule = s.cfg.Android
	}

	if rule.Latest == "" {
		return VersionCheckOutcome{LatestVersion: current}
	}

	cmp, err := CompareVersions(current, rule.Latest)
	if err != nil {
		return VersionCheckOutcome{
			LatestVersion: rule.Latest,
			DownloadURL:   rule.DownloadURL,
			ReleaseNotes:  rule.ReleaseNotes,
		}
	}

	out := VersionCheckOutcome{
		HasUpdate:     cmp < 0,
		LatestVersion: rule.Latest,
		DownloadURL:   rule.DownloadURL,
		ReleaseNotes:  rule.ReleaseNotes,
	}
	if out.HasUpdate && rule.ForceBelow != "" {
		// ForceBelow 配置非法时同样降级:不因坏配置误伤(强制强制更新)。
		if forceCmp, ferr := CompareVersions(current, rule.ForceBelow); ferr == nil && forceCmp < 0 {
			out.ForceUpdate = true
		}
	}
	return out
}

// CompareVersions 数字版本比较:current<latest → -1;相等 → 0;> → 1。
// 规则:trim 后允许一个前导 'v'/'V';段数 1~3,缺段按 0 补齐("1.2" == "1.2.0");
// 每段必须全数字(允许前导零,按数值解析);含 '-'/'+'(预发布/构建元数据)、
// 空段、非数字段 → error(调用方按「无更新」降级)。
func CompareVersions(current, latest string) (int, error) {
	a, err := parseVersion(current)
	if err != nil {
		return 0, fmt.Errorf("parse current version: %w", err)
	}
	b, err := parseVersion(latest)
	if err != nil {
		return 0, fmt.Errorf("parse latest version: %w", err)
	}
	for i := range a {
		switch {
		case a[i] < b[i]:
			return -1, nil
		case a[i] > b[i]:
			return 1, nil
		}
	}
	return 0, nil
}

// parseVersion 解析 1~3 段数字版本号为数值三元组,缺段按 0 补齐。
func parseVersion(raw string) ([3]int, error) {
	var out [3]int
	s := strings.TrimSpace(raw)
	if s == "" {
		return out, fmt.Errorf("version %q is empty", raw)
	}
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")

	parts := strings.Split(s, ".")
	if len(parts) > 3 {
		return out, fmt.Errorf("version %q has more than 3 segments", raw)
	}
	for i, part := range parts {
		if part == "" {
			return out, fmt.Errorf("version %q has an empty segment", raw)
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return out, fmt.Errorf("version segment %q is not numeric", part)
			}
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return out, fmt.Errorf("version segment %q: %w", part, err)
		}
		out[i] = n
	}
	return out, nil
}
