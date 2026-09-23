import { IconQrcode } from "@arco-design/web-react/icon";
import { Popover } from "@arco-design/web-react";

import { assetUrl } from "../utils/asset-url";

// 右下角悬浮作者二维码入口:hover 展开 Popover 展示二维码图片。
// 资源在 public/assets/author/ 下,必须经 assetUrl 引用(子路径部署硬规则)。
export default function AuthorQrcodeFloat() {
  return (
    <Popover
      trigger="hover"
      position="left"
      content={
        <img
          className="author-qrcode-img"
          src={assetUrl("assets/author/QRCode.JPG")}
          alt="作者二维码"
        />
      }
    >
      <div className="author-qrcode-float" role="button" aria-label="作者二维码">
        <IconQrcode />
      </div>
    </Popover>
  );
}
