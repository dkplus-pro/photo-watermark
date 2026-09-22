import { Tooltip } from "@arco-design/web-react";
import { cloneElement, isValidElement, type ReactElement } from "react";

import { usePermission } from "../hooks/use-permission";

interface AuthGateProps {
  /** 所需权限码;传数组表示任一命中即可。 */
  permission: string | string[];
  /** 无权限时的提示文案。 */
  tip?: string;
  children: ReactElement<Record<string, unknown>>;
}

// 权限门卫:包裹操作按钮等交互元素,无权限时置灰并 Tooltip 提示(见 docs/admin.md)。
// 置灰只是体验层,服务端中间件仍是真正的安全边界。
export default function AuthGate({ permission, tip = "无权限", children }: AuthGateProps) {
  const hasPermission = usePermission();
  const allowed = Array.isArray(permission)
    ? permission.some(hasPermission)
    : hasPermission(permission);

  if (allowed) {
    return children;
  }
  if (!isValidElement(children)) {
    return children;
  }
  return (
    <Tooltip content={tip}>
      <span style={{ cursor: "not-allowed", display: "inline-block" }}>
        {cloneElement(children, { disabled: true })}
      </span>
    </Tooltip>
  );
}
