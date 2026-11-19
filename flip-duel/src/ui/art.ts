/**
 * 卡面图案（public/art/，由 scripts/gen_art.py 生成）。
 * 人物、特效、武器、马来自 ninja-battle 用的 Ninja Adventure 素材包（CC0），其余为自绘像素图标。
 */
const ART: Record<string, string> = {
  // 中立
  n01: 'sword', n02: 'sprout', n03: 'char-ninjablue', n04: 'char-ninjared', n05: 'flag',
  n06: 'char-redgladiator', n07: 'drum', n08: 'coin', n09: 'rock', n10: 'w-katana',
  n11: 'shield', n12: 'w-lance', n13: 'drum', n14: 'snowball', n15: 'w-bow',
  n16: 'char-gladiatorblue', n17: 'mirror', n18: 'shield-green', n19: 'char-ninjafire', n20: 'char-gladiatorblue-attack',
  n21: 'flag-blue', n22: 'drum', n23: 'w-bow', n24: 'sprout', n25: 'chest',
  n26: 'w-lance', n27: 'char-redgladiator-attack', n28: 'star', n29: 'fx-explosion', n30: 'char-ninjawater',
  n31: 'crown', n32: 'flame', n33: 'flame-blue', n34: 'crown-pink', n35: 'gem-red',
  // 矿工
  m01: 'ore-copper', m02: 'rock', m03: 'pickaxe', m04: 'helmet', m05: 'minecart',
  m06: 'dynamite', m07: 'coin', m08: 'coal', m09: 'lamp', m10: 'char-ninjafire-attack',
  m11: 'ore-silver', m12: 'drill', m13: 'rail', m14: 'dynamite-blue', m15: 'ore-gold',
  m16: 'gem-cyan', m17: 'helmet-red', m18: 'lamp', m19: 'rail', m20: 'helmet',
  m21: 'ore-gold', m22: 'map', m23: 'fx-explosion', m24: 'gem-blue', m25: 'drill-red',
  m26: 'coin', m27: 'ore-gold', m28: 'fx-smoke', m29: 'pickaxe-gold', m30: 'gem-red',
  m31: 'gem-white', m32: 'chest', m33: 'flame', m34: 'drill-red', m35: 'crown',
  // 黑客
  h01: 'docs', h02: 'horse-brown', h03: 'laptop', h04: 'cloud', h05: 'bug',
  h06: 'flame-blue', h07: 'loop', h08: 'envelope', h09: 'chip', h10: 'robot',
  h11: 'bug', h12: 'envelope', h13: 'docs', h14: 'gear', h15: 'fx-explosion',
  h16: 'database', h17: 'char-ninjablue-attack', h18: 'loop', h19: 'door', h20: 'cloud',
  h21: 'lock', h22: 'chip-red', h23: 'skull', h24: 'gear', h25: 'bug-red',
  h26: 'key', h27: 'robot', h28: 'shield-green', h29: 'gem-purple', h30: 'coin',
  h31: 'robot-gold', h32: 'skull-red', h33: 'laptop', h34: 'eye', h35: 'chip-gold',
};

export const artUrl = (id: string) => `${import.meta.env.BASE_URL}art/${ART[id] ?? 'star'}.png`;

/** 卡背：按职业区分颜色和纹路（不放图案）；野怪单独一种 */
export type BackKind = 'miner' | 'hacker' | 'neutral' | 'monster';
