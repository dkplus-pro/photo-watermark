// 图片包装组件(阶段 5.2):强制 lazy/decoding 语义,业务不再裸写 <img>(壳约定)。
// 部署图片多走 CDN 直链,显式尺寸防布局抖动(CLS);alt 由调用方传入(可访问性)。
interface SiteImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** 懒加载开关:首屏关键图可显式传 false */
  eager?: boolean;
}

export function SiteImage({ src, alt, width, height, className, eager = false }: SiteImageProps) {
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
