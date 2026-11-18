import type { Building, BuildingCategory, RoadHazard } from '../contracts';

export interface CategoryStyle {
  label: string;
  color: string;
  fill: string;
}

// 键是 category 值，不是楼栋 id；D2 补齐 20 栋时此表零改动。
// 颜色取 CSS token（var(...)），随 html[data-theme] 双主题换肤；须用于 style 绑定而非 SVG 属性。
export const CATEGORY_STYLE: Record<BuildingCategory, CategoryStyle> = {
  dormitory: { label: '宿舍', color: 'var(--cat-dormitory)', fill: 'var(--cat-dormitory-fill)' },
  canteen: { label: '食堂', color: 'var(--cat-canteen)', fill: 'var(--cat-canteen-fill)' },
  teaching: { label: '教学', color: 'var(--cat-teaching)', fill: 'var(--cat-teaching-fill)' },
  laboratory: { label: '实验', color: 'var(--cat-laboratory)', fill: 'var(--cat-laboratory-fill)' },
  library: { label: '图书', color: 'var(--cat-library)', fill: 'var(--cat-library-fill)' },
  gymnasium: { label: '体育', color: 'var(--cat-gymnasium)', fill: 'var(--cat-gymnasium-fill)' },
  office: { label: '办公', color: 'var(--cat-office)', fill: 'var(--cat-office-fill)' },
  other: { label: '其他', color: 'var(--cat-other)', fill: 'var(--cat-other-fill)' },
};

export const CATEGORY_ORDER: BuildingCategory[] = [
  'dormitory',
  'canteen',
  'teaching',
  'laboratory',
  'library',
  'gymnasium',
  'office',
  'other',
];

export function formatBuildingFloors({ floors, category }: Pick<Building, 'floors' | 'category'>): string {
  if (floors !== null) return `${floors} 层`;
  return category === 'gymnasium' ? '通高' : '未公开';
}

export const HAZARD_LABEL: Record<Exclude<RoadHazard, null>, string> = {
  flood: '积水',
  fire: '火灾',
  debris: '瓦砾',
};
