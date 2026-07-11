import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

const THEME_MODE_KEY = 'app-theme-mode';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  input: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  onAccent: string;
  neutralButton: string;
  bookmark: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  overlay: string;
  shadow: string;
  readerBackground: string;
  readerText: string;
  readerMuted: string;
  readerBorder: string;
  placeholder: string;
}

const LIGHT_COLORS: AppColors = {
  background: '#F4F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#E6EDF3',
  surfaceRaised: '#FFFFFF',
  input: '#F9FBFC',
  text: '#20262E',
  textSecondary: '#52606C',
  textMuted: '#7B8792',
  border: '#D5DFE7',
  accent: '#0096FA',
  accentStrong: '#007FC9',
  accentSoft: '#EAF7FF',
  onAccent: '#FFFFFF',
  neutralButton: '#35404A',
  bookmark: '#FFB000',
  danger: '#C73848',
  dangerSoft: '#FFF0F2',
  warning: '#8B6A00',
  overlay: 'rgba(17, 26, 35, 0.48)',
  shadow: '#17212B',
  readerBackground: '#FFFDF8',
  readerText: '#24282D',
  readerMuted: '#6F6A63',
  readerBorder: '#E6E0D5',
  placeholder: '#89949E',
};

const DARK_COLORS: AppColors = {
  background: '#0D1117',
  surface: '#161B22',
  surfaceAlt: '#21262D',
  surfaceRaised: '#1C232C',
  input: '#0F141A',
  text: '#F2F5F7',
  textSecondary: '#B7C0C8',
  textMuted: '#8B96A1',
  border: '#303943',
  accent: '#29A8FF',
  accentStrong: '#65C3FF',
  accentSoft: '#102C3D',
  onAccent: '#FFFFFF',
  neutralButton: '#34404B',
  bookmark: '#FFC247',
  danger: '#FF7B86',
  dangerSoft: '#3B1D24',
  warning: '#E8C85B',
  overlay: 'rgba(0, 0, 0, 0.68)',
  shadow: '#000000',
  readerBackground: '#12100E',
  readerText: '#ECE7DF',
  readerMuted: '#A69E94',
  readerBorder: '#332E28',
  placeholder: '#7D8995',
};

interface ThemeContextValue {
  colors: AppColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let isMounted = true;

    async function restoreThemeMode() {
      const savedMode = await SecureStore.getItemAsync(THEME_MODE_KEY).catch(
        () => null,
      );

      if (
        isMounted &&
        (savedMode === 'system' ||
          savedMode === 'light' ||
          savedMode === 'dark')
      ) {
        setModeState(savedMode);
      }
    }

    void restoreThemeMode();

    return () => {
      isMounted = false;
    };
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    void SecureStore.setItemAsync(THEME_MODE_KEY, nextMode).catch(() => {});
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      isDark,
      mode,
      setMode,
    }),
    [colors, isDark, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('useAppThemeはAppThemeProviderの内側で使ってね');
  }

  return value;
}
