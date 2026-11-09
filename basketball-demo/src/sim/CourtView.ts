import Phaser from 'phaser';
import {
  CIRCLE_RADIUS,
  COURT,
  COURT_BOTTOM,
  COURT_CY,
  COURT_RIGHT,
  HOOP_INSET,
  KEY_LENGTH,
  KEY_WIDTH,
  RIM_RADIUS,
  THREE_CORNER_Y,
  THREE_RADIUS,
  hoopFor,
} from './court';

/** 用 Graphics 画一个俯视木地板球场：边线、中圈、三秒区、三分线、篮板和篮筐 */
export function drawCourt(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // 场外地面
  g.fillStyle(0x6b4a2b, 1);
  g.fillRect(COURT.left - 14, COURT.top - 10, COURT.width + 28, COURT.height + 20);
  // 木地板条纹
  for (let i = 0; i < COURT.width; i += 20) {
    g.fillStyle(i % 40 === 0 ? 0xc89a62 : 0xbe8f58, 1);
    g.fillRect(COURT.left + i, COURT.top, 20, COURT.height);
  }
  // 三秒区底色
  g.fillStyle(0xb0573a, 1);
  g.fillRect(COURT.left, COURT_CY - KEY_WIDTH / 2, KEY_LENGTH, KEY_WIDTH);
  g.fillRect(COURT_RIGHT - KEY_LENGTH, COURT_CY - KEY_WIDTH / 2, KEY_LENGTH, KEY_WIDTH);

  g.lineStyle(2, 0xf7f1e3, 1);
  g.strokeRect(COURT.left, COURT.top, COURT.width, COURT.height);
  // 中线、中圈
  g.lineBetween(COURT.left + COURT.width / 2, COURT.top, COURT.left + COURT.width / 2, COURT_BOTTOM);
  g.strokeCircle(COURT.left + COURT.width / 2, COURT_CY, CIRCLE_RADIUS);

  for (const dir of [1, -1] as const) {
    const hoop = hoopFor(dir);
    const baseX = dir === 1 ? COURT_RIGHT : COURT.left;
    const keyFarX = baseX - dir * KEY_LENGTH;
    // 三秒区
    g.strokeRect(Math.min(baseX, keyFarX), COURT_CY - KEY_WIDTH / 2, KEY_LENGTH, KEY_WIDTH);
    // 罚球圈
    g.strokeCircle(keyFarX, COURT_CY, CIRCLE_RADIUS);
    // 三分线：两段底角直线 + 圆弧
    const cornerY1 = COURT.top + THREE_CORNER_Y;
    const cornerY2 = COURT_BOTTOM - THREE_CORNER_Y;
    const dyCorner = COURT.height / 2 - THREE_CORNER_Y;
    const dxCorner = Math.sqrt(Math.max(0, THREE_RADIUS * THREE_RADIUS - dyCorner * dyCorner));
    const arcEndX = hoop.x - dir * dxCorner;
    g.lineBetween(baseX, cornerY1, arcEndX, cornerY1);
    g.lineBetween(baseX, cornerY2, arcEndX, cornerY2);
    const a1 = Math.atan2(cornerY1 - hoop.y, arcEndX - hoop.x);
    const a2 = Math.atan2(cornerY2 - hoop.y, arcEndX - hoop.x);
    g.beginPath();
    if (dir === 1) {
      // 右侧篮筐，弧在左边（角度经过 π）
      g.arc(hoop.x, hoop.y, THREE_RADIUS, a2, a1, false);
    } else {
      g.arc(hoop.x, hoop.y, THREE_RADIUS, a1, a2, false);
    }
    g.strokePath();
    // 篮板（底线内 1.2m 处的横板）
    const boardX = baseX - dir * (HOOP_INSET - 0.375 * 20);
    g.lineStyle(3, 0xe8e8e8, 1);
    g.lineBetween(boardX, COURT_CY - 18, boardX, COURT_CY + 18);
    // 篮筐
    g.lineStyle(2, 0xff7a2a, 1);
    g.strokeCircle(hoop.x, hoop.y, RIM_RADIUS + 1.5);
    g.lineStyle(2, 0xf7f1e3, 1);
  }
  return g;
}
