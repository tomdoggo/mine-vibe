/**
 * 全部卡牌数据。id 一旦上线就不要改（数据库里的幽灵卡组靠 id 还原）。
 * 每个职业 / 中立：10 白 + 10 蓝 + 10 紫 + 5 橙 = 35 张。
 * 格式：[id, 名字, 品质, 铜卡底分, 效果, 标签]
 * 价格：白 2 / 蓝 3 / 紫 4 / 橙 5（见 config.ts）
 */
import { registerCards } from './cards.ts';

registerCards('neutral', [
  // 白
  ['n01', '白板', 'white', 10, []],
  ['n02', '成长', 'white', 0, [['grow', 1]]],
  ['n03', '邻里', 'white', 6, [['adjAlly', 3]]],
  ['n04', '独行侠', 'white', 6, [['alone', 8]]],
  ['n05', '先锋', 'white', 6, [['early', 7]]],
  ['n06', '压轴', 'white', 6, [['late', 7]]],
  ['n07', '号手', 'white', 5, [['buffNext', 6]]],
  ['n08', '储蓄罐', 'white', 4, [['gold', 1]]],
  ['n09', '绊脚石', 'white', 6, [['debuffNext', 5]]],
  ['n10', '决战者', 'white', 5, [['round3', 10]]],
  // 蓝
  ['n11', '角落守卫', 'blue', 9, [['corner', 16]]],
  ['n12', '方阵兵', 'blue', 7, [['rowAlly', 4]]],
  ['n13', '鼓手', 'blue', 8, [['buffAdj', 5]]],
  ['n14', '雪球', 'blue', 2, [['grow', 2]]],
  ['n15', '后发制人', 'blue', 5, [['prevAlly', 2]]],
  ['n16', '拦路虎', 'blue', 8, [['debuffAdj', 6]]],
  ['n17', '镜子', 'blue', 4, [['copyPrev']]],
  ['n18', '盾卫', 'blue', 13, [['shield']]],
  ['n19', '小偷', 'blue', 6, [['steal', 4]]],
  ['n20', '老兵', 'blue', 6, [['scaleRound', 4]]],
  // 紫
  ['n21', '指挥官', 'purple', 6, [['adjAlly', 4], ['buffAdj', 4]]],
  ['n22', '战鼓', 'purple', 6, [['doubleNext']]],
  ['n23', '狙击手', 'purple', 10, [['silenceNext']]],
  ['n24', '园丁', 'purple', 7, [['growAdj', 1]]],
  ['n25', '宝箱', 'purple', 8, [['gold', 2]]],
  ['n26', '列阵', 'purple', 7, [['colAlly', 6]]],
  ['n27', '吸血鬼', 'purple', 7, [['adjEnemy', 6]]],
  ['n28', '智者', 'purple', 3, [['grow', 3]]],
  ['n29', '破城锤', 'purple', 9, [['destroyRandomEnemy', 1]]],
  ['n30', '中军', 'purple', 10, [['center', 14]]],
  // 橙
  ['n31', '国王', 'orange', 15, [['buffAdj', 8], ['shield']]],
  ['n32', '凤凰', 'orange', 5, [['grow', 4], ['round3', 10]]],
  ['n33', '巨龙', 'orange', 32, []],
  ['n34', '女王', 'orange', 8, [['prevAlly', 4]]],
  ['n35', '贤者之石', 'orange', 6, [['growRandom', 4], ['gold', 1]]],
]);

/* 矿工：挖矿成长 + 赚金币 + 炸药。【矿】越多越强，【工】具强化矿石 */
registerCards('miner', [
  // 白
  ['m01', '铜矿石', 'white', 4, [['grow', 1]], '矿'],
  ['m02', '碎石', 'white', 10, [], '矿'],
  ['m03', '铁镐', 'white', 5, [['perTag', 2, '矿']], '工'],
  ['m04', '矿工帽', 'white', 6, [['buffNext', 6]], '工'],
  ['m05', '手推车', 'white', 6, [['colAlly', 4]], '工'],
  ['m06', '炸药', 'white', 4, [['debuffAdj', 6]], '工'],
  ['m07', '淘金盘', 'white', 3, [['gold', 1]], '工'],
  ['m08', '煤块', 'white', 6, [['round3', 8]], '矿'],
  ['m09', '矿灯', 'white', 6, [['adjAlly', 3]], '工'],
  ['m10', '学徒矿工', 'white', 4, [['perTag', 1, '矿'], ['grow', 1]]],
  // 蓝
  ['m11', '银矿石', 'blue', 4, [['grow', 2]], '矿'],
  ['m12', '钻头', 'blue', 6, [['growAdj', 1]], '工'],
  ['m13', '矿道', 'blue', 6, [['colAlly', 6]], '工'],
  ['m14', '雷管', 'blue', 6, [['debuffAdj', 8]], '工'],
  ['m15', '金砂', 'blue', 3, [['gold', 1], ['grow', 1]], '矿'],
  ['m16', '水晶簇', 'blue', 6, [['perTag', 3, '矿']], '矿'],
  ['m17', '工头', 'blue', 7, [['buffAdj', 6]]],
  ['m18', '坑道深处', 'blue', 4, [['late', 10], ['grow', 1]], '矿'],
  ['m19', '铁轨', 'blue', 7, [['rowAlly', 4]], '工'],
  ['m20', '安全帽', 'blue', 13, [['shield']], '工'],
  // 紫
  ['m21', '金矿石', 'purple', 8, [['grow', 3]], '矿'],
  ['m22', '地质图', 'purple', 4, [['growTag', 1, '矿']]],
  ['m23', '爆破专家', 'purple', 8, [['destroyAdjEnemy']]],
  ['m24', '宝石匠', 'purple', 5, [['perTag', 4, '矿']]],
  ['m25', '蒸汽钻机', 'purple', 8, [['growAdj', 2]], '工'],
  ['m26', '金块', 'purple', 6, [['gold', 2]], '矿'],
  ['m27', '矿脉', 'purple', 6, [['colAlly', 5], ['grow', 1]], '矿'],
  ['m28', '塌方', 'purple', 5, [['debuffAdj', 8], ['debuffNext', 8]]],
  ['m29', '矿工工会', 'purple', 6, [['perTag', 3, '工']]],
  ['m30', '红宝石', 'purple', 14, [['corner', 12]], '矿'],
  // 橙
  ['m31', '钻石矿脉', 'orange', 10, [['grow', 5]], '矿'],
  ['m32', '黄金国', 'orange', 6, [['gold', 4]]],
  ['m33', '地心熔炉', 'orange', 8, [['growTag', 3, '矿']]],
  ['m34', '巨型钻机', 'orange', 18, [['growAdj', 3]], '工'],
  ['m35', '矿业大亨', 'orange', 6, [['perGold', 3]]],
]);

/* 黑客：偷分、封锁、病毒、连锁程序。【码】互相叠加，【毒】削弱对手 */
registerCards('hacker', [
  // 白
  ['h01', '脚本', 'white', 7, [['prevAlly', 1]], '码'],
  ['h02', '木马', 'white', 5, [['debuffNext', 6]], '毒'],
  ['h03', '键盘侠', 'white', 6, [['adjEnemy', 3]]],
  ['h04', '代理', 'white', 6, [['buffNext', 6]], '码'],
  ['h05', '爬虫', 'white', 6, [['steal', 2]], '码'],
  ['h06', '防火墙', 'white', 9, [['shield'], ['adjAlly', 1]]],
  ['h07', '死循环', 'white', 4, [['scaleRound', 4]], '码'],
  ['h08', '垃圾邮件', 'white', 4, [['debuffAdj', 5]], '毒'],
  ['h09', '缓存', 'white', 2, [['grow', 1], ['prevAlly', 1]], '码'],
  ['h10', '机器人', 'white', 5, [['perTag', 2, '码']], '码'],
  // 蓝
  ['h11', '蠕虫', 'blue', 4, [['virus', 2]], '毒'],
  ['h12', '钓鱼网站', 'blue', 5, [['steal', 4]], '毒'],
  ['h13', '复制粘贴', 'blue', 6, [['copyPrev']], '码'],
  ['h14', '编译器', 'blue', 6, [['buffNext', 12]], '码'],
  ['h15', 'DDoS', 'blue', 4, [['debuffAdj', 8]], '毒'],
  ['h16', '数据库', 'blue', 3, [['grow', 2]], '码'],
  ['h17', '黑客帽', 'blue', 7, [['adjEnemy', 5]]],
  ['h18', '递归', 'blue', 2, [['prevAlly', 3]], '码'],
  ['h19', '后门', 'blue', 6, [['silenceNext']], '毒'],
  ['h20', '云服务器', 'blue', 8, [['rowAlly', 5]], '码'],
  // 紫
  ['h21', '勒索病毒', 'purple', 4, [['virus', 3]], '毒'],
  ['h22', '超频', 'purple', 7, [['doubleNext']], '码'],
  ['h23', '零日漏洞', 'purple', 7, [['destroyRandomEnemy', 1]], '毒'],
  ['h24', '算法', 'purple', 4, [['perTag', 4, '码']], '码'],
  ['h25', '僵尸网络', 'purple', 3, [['perTag', 4, '毒']], '毒'],
  ['h26', '数据窃取', 'purple', 6, [['steal', 6]], '毒'],
  ['h27', '机器学习', 'purple', 4, [['grow', 3]], '码'],
  ['h28', '杀毒软件', 'purple', 12, [['shield'], ['buffAdj', 4]]],
  ['h29', '量子比特', 'purple', 7, [['scaleRound', 6]], '码'],
  ['h30', '黑市', 'purple', 6, [['gold', 2]]],
  // 橙
  ['h31', '人工智能', 'orange', 8, [['growTag', 2, '码']], '码'],
  ['h32', '系统崩溃', 'orange', 4, [['virus', 5]], '毒'],
  ['h33', '主控台', 'orange', 10, [['doubleNext'], ['buffAdj', 6]], '码'],
  ['h34', '暗网', 'orange', 8, [['steal', 8]], '毒'],
  ['h35', '超级计算机', 'orange', 22, [['prevAlly', 2]], '码'],
]);
