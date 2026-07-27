import { Platform, useWindowDimensions } from 'react-native';

/** 超过这个宽度就切换到桌面端的左右分栏布局 */
export const WIDE_BREAKPOINT = 900;

export interface Responsive {
  width: number;
  height: number;
  /** 双栏布局：Windows / macOS 客户端、iPad 横屏、大屏浏览器 */
  isWide: boolean;
  /** 真正的桌面客户端（Electron / 浏览器） */
  isDesktop: boolean;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isWide: width >= WIDE_BREAKPOINT,
    isDesktop: Platform.OS === 'web',
  };
}
