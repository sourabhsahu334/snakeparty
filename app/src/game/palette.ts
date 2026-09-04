/**
 * The shared colour palette, mirroring `COLORS` in server/src/config.js.
 *
 * Snakes and food refer to colours by index into this list, so both ends have
 * to agree on the order. It lives in its own module because both the socket
 * layer and the offline arena need it, and importing one from the other would
 * be circular.
 */
export const PALETTE = [
  '#FF9E2C', '#FF4FA3', '#7ED321', '#3FA9F5', '#B06AB3',
  '#FF5E5B', '#FFD93D', '#2EC4B6', '#33383D', '#F26430',
  '#9BE564', '#41EAD4', '#F582AE', '#8AC926', '#1982C4',
  '#FF7B00', '#E63946', '#06D6A0', '#7B2CBF', '#FFC300',
];
