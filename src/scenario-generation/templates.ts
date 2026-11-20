import mapJson from '../../fixtures/campus-map.json' with { type: 'json' };
import baseline from '../../fixtures/canonical-run.json' with { type: 'json' };
import type { ActionId, CanonicalFixture, ResourceDef, RoadHazard } from '../contracts';
import type { MapSource } from '../fixture-port';
import type { Candidate, Modifier, TemplateId } from './contracts';

const canonical = baseline as CanonicalFixture;
export const campusMap: MapSource = mapJson as MapSource;
export const actionCatalog = canonical.action_catalog;
export const resources: ResourceDef[] = canonical.scenario.resources;
export const playbackSpeeds = canonical.scenario.playback_speeds;

interface ScenarioTemplate {
  id: TemplateId;
  name: string;
  description: string;
  modifiers: Modifier[];
  routes: Record<string, string[]>;
  preset: Candidate;
  confirmed: string;
  intensifies: string;
  variables: [string, string];
  hazard: Exclude<RoadHazard, null>;
  hazardText: string;
  actions: ActionId[];
  reports: {
    witness: string;
    staff: string;
    verified: string;
    falseAlarm: string;
    duplicate: string;
    newClue: string;
    rumor: string;
  };
}

export const templates: readonly ScenarioTemplate[] = [
  {
    id: 'TPL-NIGHT-DORM-01', name: '宿舍火情与积水',
    description: '夜间宿舍疑似火情。暴雨加剧后，一条近路因积水不能通行。',
    modifiers: ['night', 'heavy_rain'], routes: { N7: ['R-N7E', 'R-N7-N1'], N1: ['R-N1-GATE3', 'R-N1-N2'] },
    preset: { start_building_id: 'N7', road_id: 'R-N7E', first_report_at: 30, confirmed_at: 90, escalation_at: 140, t_end: 300, perspective: 'witness' },
    confirmed: '宿舍火情已核实', intensifies: '降雨加剧，低处通道出现积水',
    variables: ['火情首报来自目击或值班转述，均需要核实', '积水使选定路段不可通行'],
    hazard: 'flood', hazardText: '积水造成路段阻断', actions: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
    reports: { witness: '住户看到楼上似乎有烟。', staff: '值班员转述，有人报告楼上冒烟。', verified: '导调已核实该宿舍出现火情。', falseAlarm: '另一处白气已经核实为水蒸气。', duplicate: '转发群消息称，还是同一处楼上冒烟。', newClue: '住户补充，楼内有人员等待引导。', rumor: '网传多处宿舍均起火，导调核对后确认该说法不实。' },
  },
  {
    id: 'TPL-LAB-LEAK-01', name: '实验楼泄漏与人员失联',
    description: '实验区域疑似泄漏。点名时一名人员未回报，外侧通道随后被散落物阻断。',
    modifiers: ['night'], routes: { SY: ['R-SA-SY', 'R-SY-G3'], G3: ['R-SY-G3', 'R-EA-G3'], G8: ['R-G3-G8', 'R-G8-CLI'] },
    preset: { start_building_id: 'SY', road_id: 'R-SA-SY', first_report_at: 25, confirmed_at: 85, escalation_at: 145, t_end: 310, perspective: 'staff' },
    confirmed: '实验区域泄漏已核实', intensifies: '转运通道被散落物阻断，点名仍有人员未回报',
    variables: ['人员失联仅为点名线索，由后续上报补充', '散落物使选定路段不可通行'],
    hazard: 'debris', hazardText: '散落物占用通道', actions: ['A1', 'A2', 'A3', 'A5'],
    reports: { witness: '学生报告实验区域附近有异常气味。', staff: '实验值班室收到异常气味上报，涉及区域待核。', verified: '导调已确认实验区发生模拟泄漏。', falseAlarm: '另一条有关报警声的消息已核实为例行检查。', duplicate: '转发的是最初那条气味上报。', newClue: '点名确认有一人尚未回报，最后记录在该楼。', rumor: '网传泄漏已经扩散至全部教学楼，导调确认消息不实。' },
  },
  {
    id: 'TPL-GYM-CROWD-01', name: '体育馆拥挤与通信中断',
    description: '体育馆出现人群拥挤。通信不稳延迟信息核实，附近通道被移位的隔离栏阻断。',
    modifiers: ['comms_outage', 'crowd_peak'], routes: { GYM: ['R-CN1-GYM', 'R-GYM-LIB', 'R-SAC-GYM'] },
    preset: { start_building_id: 'GYM', road_id: 'R-GYM-LIB', first_report_at: 20, confirmed_at: 95, escalation_at: 155, t_end: 320, perspective: 'witness' },
    confirmed: '体育馆出口拥挤风险已核实', intensifies: '通信回报间歇中断，移位的隔离栏挡住通道',
    variables: ['通信中断仅由回报延迟和节点叙事体现', '移位隔离栏使选定路段不可通行'],
    hazard: 'debris', hazardText: '移位隔离栏阻断通道', actions: ['A1', 'A2', 'A3', 'A4', 'A5'],
    reports: { witness: '离场人员称出口附近有拥堵。', staff: '场馆值班员转述出口排队停滞，现场情况待核。', verified: '现场导调已确认出口附近人群拥挤。', falseAlarm: '关于另一个入口完全堵死的消息已核实不实。', duplicate: '群里转发的仍是同一条出口排队消息。', newClue: '现场人员补充，拥挤区域附近需要引导。', rumor: '网传场馆全部出口关闭，导调核对后确认消息不实。' },
  },
];

export function getTemplate(id: string): ScenarioTemplate | undefined {
  return templates.find((template) => template.id === id);
}
