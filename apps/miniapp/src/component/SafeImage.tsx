// 图片封装(方案 §5 阶段 4b):lazy-load + mode 约束 + 加载失败兜底。
// 失败兜底为内置占位(样式类),不引外部资源;显示逻辑抽出纯函数便于单测。
import { Image, type ImageProps, View } from "@tarojs/components";
import { useState } from "react";

import { shouldUseFallback } from "./safe-image-logic";

export interface SafeImageProps {
  src: string;
  /** 裁剪缩放模式,默认 aspectFill(活动页视觉约定) */
  mode?: ImageProps["mode"];
  /** 加载失败/空 src 时的替代文案,默认「图片不可用」 */
  fallbackText?: string;
  className?: string;
}

export function SafeImage({ src, mode = "aspectFill", fallbackText = "图片不可用", className }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const useFallback = shouldUseFallback(src) || failed;

  if (useFallback) {
    return (
      <View className={["safe-image-fallback", className].filter(Boolean).join(" ")}>
        <View className="safe-image-fallback__text">{fallbackText}</View>
      </View>
    );
  }
  return (
    <Image
      className={["safe-image", className].filter(Boolean).join(" ")}
      src={src}
      mode={mode}
      lazyLoad
      onError={() => setFailed(true)}
    />
  );
}
