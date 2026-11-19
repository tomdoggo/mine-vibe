import { ROLE_ORDER, type Attributes, type PlayerDef, type Role } from '../data/players';

/**
 * 按能力值给五个人分配站位（弧顶 / 两侧翼 / 肘区 / 低位），名单上写的位置只是标签，引擎不看。
 * 这样可以摆“五个中锋”这类奇怪阵容：谁最像内线谁站低位，剩下的人里传球最好的去弧顶。
 *  1. 内线度 = 篮下 + 篮板 + 禁区防守 − 三分，最高的站 C 位（低位），第二站 PF 位（肘区）；
 *  2. 剩下三人里助攻最高的站 PG 位（弧顶）；
 *  3. 最后两人三分高的站 SG 位，另一个站 SF 位（两个侧翼）。
 */
export function assignSpots(defs: PlayerDef[]): Role[] {
  const idx = defs.map((_, i) => i);
  const inside = (i: number) => {
    const a = defs[i].attrs;
    return a.inside + a.rebound + a.insideDef - a.three;
  };
  const byInside = [...idx].sort((x, y) => inside(y) - inside(x) || x - y);
  const spots: Role[] = new Array(defs.length).fill('SF');
  const taken = new Set<number>();
  const take = (i: number, r: Role) => {
    spots[i] = r;
    taken.add(i);
  };
  if (byInside.length > 0) take(byInside[0], 'C');
  if (byInside.length > 1) take(byInside[1], 'PF');
  const rest = idx.filter((i) => !taken.has(i));
  rest.sort((x, y) => defs[y].attrs.assist - defs[x].attrs.assist || x - y);
  if (rest.length > 0) take(rest[0], 'PG');
  const wings = idx.filter((i) => !taken.has(i));
  wings.sort((x, y) => defs[y].attrs.three - defs[x].attrs.three || x - y);
  if (wings.length > 0) take(wings[0], 'SG');
  if (wings.length > 1) take(wings[1], 'SF');
  return spots;
}

/** 站位在 ROLE_ORDER 里的序号：0 = 弧顶 … 4 = 低位；对位和发球接应都按它 */
export function spotIndex(spot: Role): number {
  return ROLE_ORDER.indexOf(spot);
}

/** 移动速度倍率按身高（两段线性）：190cm 及以下 1.0，205cm 0.93，216cm 及以上 0.83；贴近原先 PG 1.0 / SG 0.97 / SF 0.94 / PF 0.88 / C 0.83 的位置表 */
export function speedForHeight(heightCm: number): number {
  if (heightCm <= 190) return 1.0;
  if (heightCm <= 205) return 1.0 - ((heightCm - 190) / 15) * 0.07;
  if (heightCm >= 216) return 0.83;
  return 0.93 - ((heightCm - 205) / 11) * 0.1;
}

/** 综合能力：八项里最好的六项平均（内线不会因为三分低被拉低，射手不会因为篮板低被拉低） */
export function ovr(a: Attributes): number {
  const v = [a.inside, a.mid, a.three, a.rebound, a.assist, a.insideDef, a.outsideDef, a.stability].sort((x, y) => y - x);
  return (v[0] + v[1] + v[2] + v[3] + v[4] + v[5]) / 6;
}
