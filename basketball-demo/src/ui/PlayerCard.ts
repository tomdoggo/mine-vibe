import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ATTR_HELP, ATTR_LABELS, type Attributes } from '../data/players';
import type { Player } from '../sim/Player';
import { staminaFactor } from '../sim/fatigue';
import { INJURY_LABEL } from '../sim/injury';
import { makeButton, textStyle } from './text';

const W = 440;
const H = 344;
/** 左列（进攻）从上到下、右列（防守 / 其他）从上到下 */
const LEFT_KEYS: (keyof Attributes)[] = ['inside', 'three', 'mid', 'assist'];
const RIGHT_KEYS: (keyof Attributes)[] = ['insideDef', 'outsideDef', 'rebound', 'stability'];
/** 中线两侧留白的一半 */
const GAP = 16;
const ROW_H = 36;

/** 球员卡：基本信息、徽章、八项能力值（50~100），叠在球场上方，点关闭或空白处收起 */
export class PlayerCard {
  private readonly scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get isOpen(): boolean {
    return this.container !== null;
  }

  show(p: Player): void {
    this.close();
    const s = this.scene;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    // 遮罩：点击空白处关闭
    const mask = s.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.45).setInteractive();
    mask.on('pointerdown', () => this.close());
    items.push(mask);

    const bg = s.add.rectangle(0, 0, W, H, 0x15151c, 0.97).setStrokeStyle(1, p.team.color);
    bg.setInteractive(); // 吃掉点击，避免穿透到遮罩
    items.push(bg);
    const left = -W / 2 + 18;
    const top = -H / 2 + 14;

    // 头像：放大的精灵
    const avatar = s.add.sprite(left + 22, top + 30, p.sprite.texture.key, 0).setScale(3);
    items.push(avatar);
    const ring = s.add.ellipse(left + 22, top + 50, 34, 12, p.team.color, 0.35);
    items.push(ring);

    items.push(s.add.text(left + 56, top, `#${p.def.number}  ${p.def.name}`, textStyle(15, '#ffffff')));
    // 名单位置只是标签，本场站位按能力值分配
    const spotNote = p.spot === p.role ? p.role : `${p.role}（本场站 ${p.spot} 位）`;
    items.push(
      s.add.text(
        left + 56,
        top + 22,
        `${p.team.name} · ${spotNote}    身高 ${p.def.height}cm   体重 ${p.def.weight}kg   年龄 ${p.def.age}`,
        textStyle(9, '#cfcfd8'),
      ),
    );
    const badges = p.def.badges.length ? p.def.badges.map((b) => `🏅 ${b}`).join('   ') : '暂无徽章';
    items.push(s.add.text(left + 56, top + 40, `徽章：${badges}`, textStyle(9, '#ffd166')));

    // 本场数据
    const st = p.stats;
    const fg = st.fga ? `${st.fgm}/${st.fga}` : '0/0';
    const tp = st.tpa ? `${st.tpm}/${st.tpa}` : '0/0';
    const ft = st.fta ? `${st.ftm}/${st.fta}` : '0/0';
    items.push(
      s.add.text(
        left,
        top + 66,
        `本场：${st.pts} 分  ${st.reb} 篮板  ${st.ast} 助攻  ${st.stl} 抢断  ${st.blk} 盖帽  ${st.tov} 失误  ${st.pf} 犯规   FG ${fg}  3P ${tp}  FT ${ft}`,
        textStyle(8, '#9a9aa8'),
      ),
    );

    // 能力值：两列
    items.push(s.add.text(left, top + 86, '能力值', textStyle(10, '#ffffff')));
    items.push(
      s.add
        .text(
          W / 2 - 18,
          top + 88,
          `${p.injury ? `【${INJURY_LABEL[p.injury]}，能力减半】 ` : ''}体力 ${Math.round(p.stamina)}（能力 ×${(staminaFactor(p.stamina) * (p.injury ? 0.5 : 1)).toFixed(2)}）${p.onCourt ? '' : ' · 替补席'}    本半场状态区间：[${Math.round(p.floor)}, +50]`,
          textStyle(8, p.injury ? '#ff8a8a' : p.stamina < 80 ? '#ffd166' : '#9a9aa8'),
        )
        .setOrigin(1, 0),
    );
    // 能力值左右对称：左列数值条从中线往左长，右列从中线往右长；「?」在外侧，点击在底部显示说明
    const right = W / 2 - 18;
    const bars = s.add.graphics();
    items.push(bars);
    const helpBg = s.add.rectangle(0, H / 2 - 30, W - 36, 40, 0x22222c, 1).setStrokeStyle(1, 0x3a3a48).setVisible(false);
    const helpText = s
      .add.text(-W / 2 + 24, H / 2 - 48, '', { ...textStyle(8, '#e8e8f0'), wordWrap: { width: W - 48 } })
      .setVisible(false);
    const helpHint = s.add.text(0, H / 2 - 30, '点能力值旁的「?」查看它的作用（打法全部由能力值决定）', textStyle(8, '#6a6a78')).setOrigin(0.5);
    items.push(helpBg, helpText, helpHint);
    let helpKey: keyof Attributes | null = null;
    const toggleHelp = (k: keyof Attributes) => {
      helpKey = helpKey === k ? null : k;
      helpBg.setVisible(helpKey !== null);
      helpText.setVisible(helpKey !== null);
      helpHint.setVisible(helpKey === null);
      if (helpKey) helpText.setText(`${ATTR_LABELS[helpKey]}：${ATTR_HELP[helpKey]}`);
    };
    const drawRow = (k: keyof Attributes, row: number, side: 'left' | 'right') => {
      const y = top + 104 + row * ROW_H;
      const v = p.def.attrs[k];
      const color = ratingColor(v);
      const outer = side === 'left' ? left : right;
      const inner = side === 'left' ? -GAP : GAP;
      const dir = side === 'left' ? 1 : -1; // 从外侧往中线的方向
      const q = makeButton(s, outer + dir * 6, y + 6, 12, 12, '?', () => toggleHelp(k), 8);
      items.push(q.container);
      const labelX = outer + dir * 16;
      items.push(s.add.text(labelX, y, ATTR_LABELS[k], textStyle(9, '#cfcfd8')).setOrigin(side === 'left' ? 0 : 1, 0));
      items.push(s.add.text(inner, y, `${v}`, textStyle(10, color)).setOrigin(side === 'left' ? 1 : 0, 0));
      const barW = Math.abs(inner - labelX);
      const fillW = (barW * (v - 50)) / 50;
      const trackX = side === 'left' ? labelX : inner;
      bars.fillStyle(0x2a2a36, 1);
      bars.fillRect(trackX, y + 15, barW, 6);
      bars.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1);
      // 左列从中线往左填，右列从中线往右填
      bars.fillRect(side === 'left' ? inner - fillW : inner, y + 15, fillW, 6);
    };
    LEFT_KEYS.forEach((k, i) => drawRow(k, i, 'left'));
    RIGHT_KEYS.forEach((k, i) => drawRow(k, i, 'right'));

    const close = makeButton(s, W / 2 - 34, -H / 2 + 16, 52, 18, '关闭', () => this.close(), 9);
    items.push(close.container);

    this.container = s.add.container(cx, cy, items).setDepth(5000);
  }

  close(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
  }
}

/** 50~100 的分值配色：60 以下灰、70 绿、80 蓝、90+ 金 */
function ratingColor(v: number): string {
  if (v >= 90) return '#ffd166';
  if (v >= 80) return '#5ea0ff';
  if (v >= 70) return '#7ed957';
  if (v >= 60) return '#cfcfd8';
  return '#8a8a98';
}
