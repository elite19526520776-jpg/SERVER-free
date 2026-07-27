import { Platform, useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  colors: {
    /** 整体背景 */
    bg: string;
    /** 卡片 / 列表面板背景 */
    surface: string;
    /** 悬浮层、输入框背景 */
    elevated: string;
    /** 桌面端侧边导航条 */
    sidebar: string;
    border: string;
    text: string;
    textMuted: string;
    textFaint: string;
    primary: string;
    primaryText: string;
    /** 自己发出的气泡 */
    bubbleOut: string;
    bubbleOutText: string;
    /** 对方发来的气泡 */
    bubbleIn: string;
    bubbleInText: string;
    danger: string;
    success: string;
    unread: string;
    ripple: string;
  };
}

const dark: Theme = {
  dark: true,
  colors: {
    bg: '#0b0f17',
    surface: '#121826',
    elevated: '#1b2333',
    sidebar: '#0d1220',
    border: '#232c3d',
    text: '#e8ecf4',
    textMuted: '#9aa5bb',
    textFaint: '#6b7689',
    primary: '#3d7dff',
    primaryText: '#ffffff',
    bubbleOut: '#3d7dff',
    bubbleOutText: '#ffffff',
    bubbleIn: '#1e2637',
    bubbleInText: '#e8ecf4',
    danger: '#f06060',
    success: '#3ecf8e',
    unread: '#f0524d',
    ripple: 'rgba(255,255,255,0.08)',
  },
};

const light: Theme = {
  dark: false,
  colors: {
    bg: '#f2f4f8',
    surface: '#ffffff',
    elevated: '#f7f8fb',
    sidebar: '#e9edf5',
    border: '#e2e6ee',
    text: '#141a24',
    textMuted: '#5d6879',
    textFaint: '#8d97a8',
    primary: '#2f6df6',
    primaryText: '#ffffff',
    bubbleOut: '#2f6df6',
    bubbleOutText: '#ffffff',
    bubbleIn: '#ffffff',
    bubbleInText: '#141a24',
    danger: '#d93b3b',
    success: '#1a9e63',
    unread: '#f0524d',
    ripple: 'rgba(0,0,0,0.06)',
  },
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

/** 各平台默认字体，避免安卓上中文字重发虚 */
export const fontFamily = Platform.select({
  ios: undefined,
  android: undefined,
  default:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
});
