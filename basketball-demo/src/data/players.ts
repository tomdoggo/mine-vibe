export type TeamId = 'blue' | 'red';
export type Role = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/**
 * 球员能力值，全部 50~100。
 * 比赛中每次动作都会在能力值基础上随机浮动（见 sim/attrs.ts），稳定性决定负向浮动的下限。
 */
export interface Attributes {
  /** 篮下投篮 */
  inside: number;
  /** 中距离投篮 */
  mid: number;
  /** 三分投篮 */
  three: number;
  /** 篮板：抢篮板时与附近球员比拼 */
  rebound: number;
  /** 助攻：传球精度，传球后短时间内提升接球者的投篮能力 */
  assist: number;
  /** 禁区防守：靠近篮筐时降低对手的投篮能力，也决定盖帽 */
  insideDef: number;
  /** 外线防守：远离篮筐时降低对手的投篮能力，也决定外线抢断 */
  outsideDef: number;
  /** 稳定性：每 2 点把随机区间的下限抬高 1 点 */
  stability: number;
}

export const ATTR_LABELS: Record<keyof Attributes, string> = {
  inside: '篮下投篮',
  mid: '中距离投篮',
  three: '三分投篮',
  rebound: '篮板',
  assist: '助攻',
  insideDef: '禁区防守',
  outsideDef: '外线防守',
  stability: '稳定性',
};

/** 球员卡上点「?」看到的能力值说明 */
export const ATTR_HELP: Record<keyof Attributes, string> = {
  inside: '离篮筐 2.2m 内出手（上篮、低位强攻）的命中率，每点 0.5%，也更不容易被封盖。篮下比三分高得越多，持球时越爱突破；篮下、篮板、禁区防守高而三分低的人会被安排到低位 / 肘区站位。',
  mid: '三分线内跳投的命中率，每点 0.12%；更重要的是更多机会“敢投”，进攻更流畅。急停干拔几乎不掉命中率。罚球也看这一项。',
  three: '三分球命中率，每点 0.25%。比中距离高得越多越常站在三分线外（反之站中距离位），内线三分够高时会拉到线外站位；侧翼两人里三分高的站 SG 位。',
  assist: '传球能力：决定传球距离、能越过几个防守人的线路、传球被截断和持球被抢断的概率。接到他的传球后 3 秒内命中率有加成。助攻高的人更爱传球；非内线三人里助攻最高的站弧顶（PG 位）负责组织。',
  insideDef: '护框：干扰并封盖篮下出手，出手点越靠近篮筐越看这一项（中距离约占一半）。也负责禁区内的抢断和盯人脚步，参与截断传球。',
  outsideDef: '外线压迫：干扰三分和中远距离跳投，出手点越靠外越看这一项。也负责外线的持球抢断和盯人脚步，参与截断传球。',
  rebound: '投篮不中后争抢篮板的权重（再加站位和随机），也决定捡球、抢到松球的范围。',
  stability: '每半场开始时掷本半场的状态下限：越高越不容易打出低迷的半场。隐藏特性：无球跑位更频繁，更容易跑出空位。',
};

export interface PlayerDef {
  /** 球员库 id（data/db/players.json）；原来的两队示例名单没有 */
  id?: string;
  number: number;
  name: string;
  /** 简称（数据面板等窄的地方用），没有就用 name */
  short?: string;
  /** 带着之前的轻伤出场：全能力值减半（赛季模式） */
  injured?: boolean;
  /** 名单上的位置，只是标签：实际站位由能力值分配（见 sim/lineup.ts），引擎不看这一项 */
  role: Role;
  /** 身高 cm */
  height: number;
  /** 体重 kg */
  weight: number;
  age: number;
  /** 获得的徽章（仅展示） */
  badges: string[];
  /** 角色精灵表编号（public/assets/chars/<id>.png） */
  sprite: number;
  attrs: Attributes;
}


export interface TeamDef {
  id: TeamId;
  name: string;
  short: string;
  color: number;
  colorCss: string;
  players: PlayerDef[];
}

const a = (
  inside: number,
  mid: number,
  three: number,
  rebound: number,
  assist: number,
  insideDef: number,
  outsideDef: number,
  stability: number,
): Attributes => ({ inside, mid, three, rebound, assist, insideDef, outsideDef, stability });

export const TEAMS: Record<TeamId, TeamDef> = {
  blue: {
    id: 'blue',
    name: '蓝队',
    short: '蓝',
    color: 0x3b82f6,
    colorCss: '#5ea0ff',
    players: [
      {
        number: 1, name: '阿光', role: 'PG', height: 188, weight: 84, age: 27, sprite: 2,
        badges: ['助攻王', '最佳阵容二阵'],
        attrs: a(62, 76, 80, 55, 92, 58, 78, 82),
      },
      {
        number: 7, name: '小七', role: 'SG', height: 196, weight: 92, age: 24, sprite: 5,
        badges: ['三分大赛冠军'],
        attrs: a(66, 80, 90, 58, 66, 60, 74, 70),
      },
      {
        number: 11, name: '老陈', role: 'SF', height: 203, weight: 102, age: 31, sprite: 12,
        badges: ['总冠军', 'FMVP'],
        attrs: a(78, 78, 72, 70, 70, 72, 76, 88),
      },
      {
        number: 23, name: '大牛', role: 'PF', height: 208, weight: 112, age: 28, sprite: 22,
        badges: ['最佳防守阵容'],
        attrs: a(86, 66, 55, 88, 56, 86, 66, 74),
      },
      {
        number: 33, name: '塔哥', role: 'C', height: 216, weight: 125, age: 30, sprite: 25,
        badges: ['篮板王', '盖帽王'],
        attrs: a(92, 56, 50, 95, 52, 94, 54, 78),
      },
    ],
  },
  red: {
    id: 'red',
    name: '红队',
    short: '红',
    color: 0xef4444,
    colorCss: '#ff6b6b',
    players: [
      {
        number: 3, name: '飞哥', role: 'PG', height: 185, weight: 80, age: 25, sprite: 3,
        badges: ['MVP', '得分王'],
        attrs: a(72, 78, 82, 54, 90, 58, 80, 78),
      },
      {
        number: 8, name: '阿豪', role: 'SG', height: 193, weight: 90, age: 29, sprite: 6,
        badges: [],
        attrs: a(64, 82, 90, 56, 64, 58, 72, 66),
      },
      {
        number: 15, name: '老白', role: 'SF', height: 201, weight: 98, age: 34, sprite: 9,
        badges: ['总冠军 ×2', '最佳第六人'],
        attrs: a(80, 84, 72, 68, 74, 72, 78, 86),
      },
      {
        number: 21, name: '铁柱', role: 'PF', height: 206, weight: 110, age: 26, sprite: 10,
        badges: ['扣篮大赛冠军'],
        attrs: a(88, 62, 52, 88, 56, 86, 66, 70),
      },
      {
        number: 50, name: '山哥', role: 'C', height: 213, weight: 128, age: 32, sprite: 13,
        badges: ['最佳防守球员', '篮板王'],
        attrs: a(90, 56, 50, 96, 52, 96, 54, 84),
      },
    ],
  },
};

/** 五个站位的顺序：弧顶、两侧翼、肘区、低位。站位由能力值分配，不是名单上的位置 */
export const ROLE_ORDER: Role[] = ['PG', 'SG', 'SF', 'PF', 'C'];

