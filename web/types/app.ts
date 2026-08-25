export type Profile = {
  user_id: string;
  username?: string | null;
  email?: string | null;
  name: string;
  phone?: string | null;
  department?: string | null;
  dept_id?: string | null;
  role: string;
  rbac_role?: string | null;
  status?: string | null;
  auth_id?: string | null;
  permissions?: Record<string, boolean> | null;
  allowed_systems: string[];
};

export type DashboardData = {
  metrics: {
    equipment: number;
    inspections: number;
    abnormal: number;
    open_repairs: number;
    completion_rate: number;
  };
  inspection_trend: Array<{ date: string; total: number; abnormal: number }>;
  recent_repairs: Array<Record<string, unknown>>;
  recent_inspections: Array<Record<string, unknown>>;
};

export type InspectionRow = {
  record_id: string;
  inspect_time: string;
  run_status: 'normal' | 'abnormal';
  light_status: 'red' | 'green';
  abnormal_note?: string | null;
  location_point?: string | null;
  equipment?: { name?: string; asset_code?: string; floor?: string } | null;
  users?: { name?: string } | null;
};

export type EquipmentMapEquipment = {
  equipment_id: string;
  name: string;
  asset_code?: string | null;
  category?: string | null;
  status?: string | null;
  floor?: string | null;
  location?: string | null;
  location_id?: string | null;
};

export type EquipmentMapMarker = {
  marker_id: string;
  equipment_id?: string | null;
  floor_id: string;
  floor?: string | null;
  x: number;
  y: number;
  label: string;
};

export type EquipmentMapLocation = {
  location_id: string;
  floor: string;
  area: string;
  detail: string;
  name?: string;
};

export type EquipmentMapData = {
  equipment: EquipmentMapEquipment[];
  markers: EquipmentMapMarker[];
  locations: EquipmentMapLocation[];
};
