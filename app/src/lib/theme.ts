import { StyleSheet } from 'react-native';

/**
 * Snake.io palette: bright cyan arena, chunky white UI with a dark navy
 * outline, gold accents. Sampled from the reference screenshots.
 */
export const theme = {
  // Arena
  arena: '#7FCFE2',
  arenaEdge: '#5FB4CA',
  hexLine: 'rgba(255,255,255,0.22)',
  rim: '#E8455A',

  // UI chrome
  panel: 'rgba(255,255,255,0.92)',
  panelSolid: '#FFFFFF',
  ink: '#17384A',
  inkDim: '#5C7C8C',
  outline: '#14384A',
  white: '#FFFFFF',
  gold: '#F5C518',
  danger: '#E8455A',
  good: '#7ED321',

  // Menus (home / lobby / results) keep the same bright identity
  bg: '#7FCFE2',
  bgDeep: '#57B3CB',
  accent: '#FF9E2C',
  accentInk: '#4A2400',

  radius: 14,
};

/**
 * One compact scale for every menu.
 *
 * These screens are landscape and short — about 360dp of usable height on a
 * phone — and every control here has to fit beside the skin picker without
 * scrolling, so the type and padding run smaller than a portrait app's would.
 */
export const ui = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 20,
  },
  title: {
    color: theme.white,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    textShadowColor: theme.outline,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  subtitle: {
    color: theme.white,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    opacity: 0.95,
  },
  label: {
    color: theme.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 5,
    opacity: 0.85,
  },
  input: {
    backgroundColor: theme.panelSolid,
    borderRadius: theme.radius,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  panel: {
    backgroundColor: theme.panel,
    borderRadius: theme.radius,
    padding: 12,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'rgba(0,0,0,0.22)',
  },
  buttonText: {
    color: theme.white,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  buttonGhost: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: theme.radius,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  buttonGhostText: {
    color: theme.white,
    fontSize: 13,
    fontWeight: '800',
  },
  disabled: { opacity: 0.45 },
  error: {
    color: theme.white,
    backgroundColor: theme.danger,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
});
