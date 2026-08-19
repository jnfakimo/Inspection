import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

type PortableRuntime = {
  env?: { get: (name: string) => string | undefined };
  serve?: (handler: (request: Request) => Promise<Response>) => unknown;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: PortableRuntime }).Deno;
const nodeEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

function requiredEnvironment(name: string) {
  const value = denoRuntime?.env?.get(name) || nodeEnvironment?.[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = requiredEnvironment('SUPABASE_URL');
const SERVICE_ROLE_KEY = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = requiredEnvironment('SUPABASE_ANON_KEY');

const allowedOrigins = new Set([
  'https://jnfakimo.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(denoRuntime?.env?.get('APP_ALLOWED_ORIGINS') || nodeEnvironment?.APP_ALLOWED_ORIGINS || '')
    .split(',').map(origin => origin.trim()).filter(Boolean),
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://jnfakimo.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== 'object' || !('name' in relation)) return '';
  return text((relation as { name?: unknown }).name, 200);
}

function extractFileExt(name: string, fallback: string) {
  const match = text(name, 80).toLowerCase().match(/\.([a-z0-9]{2,8})$/);
  return match ? match[1] : fallback;
}

function nextRequestRequestId() {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canonicalFloor(value: unknown) {
  const raw = text(value, 20).toUpperCase().replace(/\s+/g, '');
  if (raw === 'B1' || raw === 'B1F') return 'B1F';
  if (raw === 'RF' || raw === 'ROOF' || raw === '頂樓') return 'RF';
  const match = raw.match(/^(\d+)F?$/);
  return match ? `${match[1]}F` : (raw || '未設定');
}

// 稽核寫入改由後端負責：與業務操作同一次請求完成，前端無法略過，
// source 標記為 app-api 以便與 V1 直寫的紀錄區分。
type AuditClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};
async function writeAudit(
  db: AuditClient, operatorId: string, table: string, recordId: string,
  auditAction: 'insert' | 'update' | 'status_change', before: unknown, after: unknown,
) {
  const { error } = await db.from('audit_logs').insert({
    table_name: table, record_id: String(recordId), action: auditAction,
    changes: { before, after }, operator_id: operatorId, source: 'app-api',
  });
  // 稽核失敗不應讓已完成的業務操作回報為失敗，僅記錄於函式日誌。
  if (error) console.warn('audit write skipped:', error.message);
}

async function countQuery(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const result = await query;
  if (result.error) console.warn('Count query skipped:', result.error.message);
  return result.error ? 0 : (result.count || 0);
}

type ModuleSource={table:string;permission:string;title:string;order?:string;columns:Array<[string,string]>;filter?:[string,string]};
const source=(table:string,permission:string,title:string,columns:Array<[string,string]>,order?:string,filter?:[string,string]):ModuleSource=>({table,permission,title,columns,order,filter});
const MODULE_SOURCES:Record<string,ModuleSource>={
  'admin/users':source('users','admin','人員帳號',[['username','帳號'],['name','姓名'],['department','單位'],['role','基本角色'],['rbac_role','RBAC 角色'],['status','狀態'],['created_at','建立時間']],'created_at'),
  'admin/permissions':source('role_permissions','admin','角色權限',[['role_id','角色'],['perm','權限代碼'],['allowed','允許']]),
  'admin/locations':source('locations','admin','場域位置',[['floor','樓層'],['area','區域'],['detail','細部位置'],['status','狀態'],['created_at','建立時間']],'floor_order'),
  'admin/audit':source('audit_logs','admin','操作稽核',[['operated_at','操作時間'],['table_name','資源'],['action','動作'],['source','來源'],['operator_id','操作人員']],'operated_at'),
  'admin/alerts':source('security_alerts','admin','資安告警',[['last_seen_at','最後發生'],['severity','等級'],['title','標題'],['actor_identifier','操作帳號'],['event_count','次數'],['status','狀態']],'last_seen_at'),
  'admin/notices':source('notifications','admin','通知中心',[['created_at','時間'],['title','標題'],['body','內容'],['is_read','已讀']],'created_at'),
  'admin/layouts':source('dashboard_layouts','admin','戰情版面',[['layout_code','版面代碼'],['layout_name','版面名稱'],['status','狀態'],['updated_at','更新時間']],'updated_at'),
  'workorder/requests':source('repair_requests','workorder','報修案件',[['created_at','報修時間'],['req_no','案件編號'],['reporter','報修人'],['department','單位'],['fault_location','故障位置'],['fault_desc','故障說明'],['urgency','急迫度'],['status','狀態']],'created_at'),
  'workorder/dispatch':source('repair_requests','workorder','派工作業',[['request_id','案件識別碼'],['updated_at','更新時間'],['req_no','案件編號'],['fault_location','位置'],['fault_desc','故障說明'],['assignee_id','指派人員'],['desired_finish','期望完成'],['status','狀態']],'updated_at'),
  'workorder/orders':source('maintenance_orders','workorder','維修工單',[['created_at','建立時間'],['order_id','工單 ID'],['request_id','報修 ID'],['assignee_id','維修人員'],['start_time','開始'],['finish_time','完成'],['status','狀態'],['result_desc','處理結果']],'created_at'),
  'workorder/attachments':source('repair_attachments','workorder','維修附件',[['uploaded_at','上傳時間'],['request_id','報修 ID'],['order_id','工單 ID'],['file_name','檔名'],['file_path','儲存路徑'],['kind','類型']],'uploaded_at'),
  'workorder/analytics':source('repair_requests','workorder','維修分析資料',[['created_at','報修時間'],['req_no','案件編號'],['department','單位'],['fault_type','故障類型'],['urgency','急迫度'],['status','狀態']],'created_at'),
  'guardpatrol/checkins':source('checkin_logs','guardpatrol','巡邏打卡',[['checkin_at','打卡時間'],['user_name','巡檢人員'],['floor_id','樓層'],['label','巡邏點'],['target_type','類型']],'checkin_at'),
  'guardpatrol/points':source('plan_markers','guardpatrol','巡邏點清單',[['floor_id','樓層'],['label','巡邏點'],['kind','類型'],['note','巡檢說明'],['status','狀態'],['updated_at','更新時間']],'updated_at',['kind','patrol']),
  'guardpatrol/shifts':source('patrol_shifts','guardpatrol','巡檢排班',[['shift_date','日期'],['name','班別'],['start_time','開始'],['end_time','結束'],['assigned_user_ids','排定人員']],'shift_date'),
  'guardpatrol/notifications':source('patrol_timeout_notifications','guardpatrol','逾時推播',[['shift_date','日期'],['shift_name','班別'],['expected_count','應巡'],['checked_count','已巡'],['unchecked_count','未巡'],['status','狀態'],['sent_at','發送時間']],'shift_date'),
  'guardpatrol/records':source('inspection_records','guardpatrol','設備巡檢',[['inspect_time','巡檢時間'],['equipment_id','設備'],['inspector_id','巡檢人員'],['location_point','位置'],['run_status','結果'],['abnormal_note','異常說明']],'inspect_time'),
  'guardpatrol/map3d':source('plan_markers','guardpatrol','3D 巡檢點',[['floor_id','樓層'],['label','名稱'],['kind','類型'],['x','X'],['y','Y'],['status','狀態']],'floor_id'),
  'handover/records':source('handover_records','handover','交接紀錄',[['shift_date','日期'],['shift_type','班別'],['issues','異常事項'],['pending','待辦'],['notes','備註'],['status','狀態'],['created_at','建立時間']],'shift_date'),
  'handover/open-items':source('handover_records','handover','未結事項',[['shift_date','日期'],['shift_type','班別'],['pending','待辦'],['issues','異常事項'],['status','狀態']],'shift_date'),
  'handover/equipment':source('equipment','handover','設備概況',[['asset_code','資產碼'],['name','設備'],['floor','樓層'],['category','分類'],['status','狀態'],['next_maintenance_on','下次保養']],'name'),
  'equipment/assets':source('equipment','equipment','設備主檔',[['asset_code','資產碼'],['name','設備名稱'],['category','分類'],['floor','樓層'],['brand','廠牌'],['model','型號'],['criticality','關鍵度'],['status','狀態']],'name'),
  'equipment/plans':source('equipment_maintenance_plans','equipment','保養排程',[['equipment_id','設備'],['item_name','保養項目'],['maintenance_type','類型'],['cycle_text','週期'],['next_due_on','下次日期'],['responsible_name','負責人'],['status','狀態']],'next_due_on'),
  'equipment/records':source('equipment_maintenance_records','equipment','維修履歷',[['performed_on','日期'],['equipment_id','設備'],['record_type','類型'],['technician','技術人員'],['maintenance_cost','維護費用'],['result','結果']],'performed_on'),
  'equipment/contracts':source('equipment_contracts','equipment','維護合約',[['equipment_id','設備'],['contract_no','合約編號'],['vendor','廠商'],['starts_on','開始'],['ends_on','結束'],['status','狀態']],'ends_on'),
  'equipment/documents':source('equipment_documents','equipment','設備文件',[['equipment_id','設備'],['document_type','類型'],['title','文件'],['file_url','檔案位置'],['created_at','建立時間']],'created_at'),
  'equipment/costs':source('equipment_annual_costs','equipment','年度成本',[['fiscal_year','年度'],['equipment_id','設備'],['repair_cost','維修費'],['maintenance_cost','保養費'],['parts_cost','零件費'],['downtime_loss','停機損失']],'fiscal_year'),
  'equipment/monitoring':source('equipment_monitor_events','equipment','中央監控事件',[['occurred_at','發生時間'],['equipment_id','設備'],['event_code','事件代碼'],['title','事件'],['severity','等級'],['message','內容'],['event_state','狀態']],'occurred_at'),
  'equipment/materials':source('materials','equipment','材料主檔',[['material_code','材料碼'],['material_name','材料名稱'],['category_id','分類'],['unit','單位'],['current_stock','庫存'],['status','狀態'],['updated_at','更新時間']],'material_name'),
  'structuremap/areas':source('floor_spaces','structuremap','區域位置表',[['floor','樓層'],['space_name','空間'],['note','備註'],['status','狀態'],['updated_at','更新時間']],'floor_order'),
  'structuremap/markers':source('plan_markers','structuremap','整合標記',[['floor_id','樓層'],['kind','類型'],['label','名稱'],['equipment_id','設備'],['repair_id','報修'],['status','狀態']],'floor_id'),
  'structuremap/floor2d':source('plan_markers','structuremap','2D 平面標記',[['floor_id','樓層'],['label','名稱'],['kind','類型'],['x','X'],['y','Y'],['color','顏色']],'floor_id'),
  'structuremap/floor3d':source('floor_models','structuremap','3D 樓層模型',[['floor_id','樓層'],['name','模型名稱'],['image_path','平面材質'],['level','樓層高度'],['updated_at','更新時間']],'floor_id'),
  'structuremap/models':source('floor_models','structuremap','模型管理',[['floor_id','樓層'],['name','模型名稱'],['image_path','平面材質'],['bbox','模型範圍'],['updated_at','更新時間']],'updated_at'),
  'structuremap/relations':source('locations','structuremap','專案關係資料',[['floor','樓層'],['area','區域'],['detail','細部位置'],['status','狀態']],'floor_order'),
  'vehicle/requests':source('vehicle_dispatch_requests','vehicle','派車申請',[['application_date','申請日'],['request_no','申請編號'],['applicant_name','申請人'],['trip_date','用車日'],['destination_location','目的地'],['trip_purpose','用途'],['plate_no','車號'],['driver_name','駕駛'],['status','狀態']],'application_date'),
  'vehicle/vehicles':source('official_vehicles','vehicle','公務車輛',[['plate_no','車號'],['vehicle_name','車名'],['brand','廠牌'],['model','型號'],['seats','座位'],['current_odometer','目前里程'],['status','狀態']],'plate_no'),
  'vehicle/drivers':source('vehicle_dispatch_drivers','vehicle','駕駛人員',[['user_id','人員 ID'],['active','啟用'],['assigned_by','設定人員'],['assigned_at','設定時間'],['updated_at','更新時間']],'updated_at'),
  'vehicle/managers':source('vehicle_dispatch_managers','vehicle','派車管理員',[['user_id','人員 ID'],['active','啟用'],['assigned_by','設定人員'],['assigned_at','設定時間'],['updated_at','更新時間']],'updated_at'),
  'vehicle/logs':source('vehicle_dispatch_logs','vehicle','派車紀錄',[['created_at','時間'],['request_id','申請 ID'],['from_status','原狀態'],['to_status','新狀態'],['action','動作'],['note','備註']],'created_at'),
  'meetingroom/bookings':source('meeting_bookings','meetingroom','會議預約',[['booking_date','日期'],['booking_no','預約編號'],['purpose','用途'],['start_time','開始'],['end_time','結束'],['status','狀態'],['created_at','建立時間']],'booking_date'),
  'meetingroom/rooms':source('meeting_rooms','meetingroom','會議室主檔',[['name','會議室'],['capacity','容量'],['floor','樓層'],['note','備註'],['status','狀態']],'name'),
  'meetingroom/changes':source('meeting_booking_change_requests','meetingroom','變更申請',[['created_at','申請時間'],['target_booking_id','原預約'],['requested_meeting_name','申請會議'],['reason','原因'],['status','狀態']],'created_at'),
  'meetingroom/notifications':source('meeting_booking_notifications','meetingroom','預約提醒',[['created_at','建立時間'],['booking_id','預約'],['notification_type','類型'],['sent_at','發送時間'],['status','狀態']],'created_at'),
};

export async function handleAppApiRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { ok: false, message: 'Method not allowed' }, 405);

  try {
    const authorization = req.headers.get('authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply(req, { ok: false, message: '未登入' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, message: '登入狀態無效' }, 401);

    const { data: globalRateAllowed, error: globalRateError } = await admin.rpc('enforce_request_rate_limit', {
      p_subject: authData.user.id,
      p_scope: 'app-api',
    });
    if (globalRateError) {
      console.error('app-api rate limit failed:', globalRateError.message);
      return reply(req, { ok: false, message: '安全限流服務暫時無法使用' }, 503);
    }
    if (globalRateAllowed !== true) {
      return reply(req, { ok: false, message: '請求過於頻繁，請稍後再試' }, 429);
    }

    const { data: profile, error: profileError } = await admin.from('users')
      .select('user_id,username,email,name,phone,department,role,rbac_role,status')
      .eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle();
    if (profileError || !profile) return reply(req, { ok: false, message: '找不到啟用中的系統帳號' }, 403);

    const roleId = profile.rbac_role || ({ admin: 'sysadmin', supervisor: 'unit_supervisor', maintenance: 'technician', inspector: 'reporter' } as Record<string, string>)[profile.role] || profile.role;
    const isSysadmin = roleId === 'sysadmin' || profile.role === 'admin';
    const { data: permissions } = await admin.from('role_permissions').select('perm,allowed').eq('role_id', roleId).eq('allowed', true).like('perm', 'sys_%');
    const allowedSystems = new Set((permissions || []).map(row => String(row.perm).replace(/^sys_/, '')));
    const can = (system: string) => isSysadmin || allowedSystems.has(system);
    const isAdmin = profile.role === 'admin' || ['admin', 'sysadmin'].includes(String(profile.rbac_role || ''));

    const userDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const body = await req.json().catch(() => ({}));
    const action = text(body.action, 40);
    const actionScope = ({
      module_data: 'app-api:module_data',
      dashboard: 'app-api:dashboard',
      inspections: 'app-api:inspections',
      equipment_map: 'app-api:equipment_map',
      update_personal_profile: 'app-api:update_personal_profile',
      open_inspection_cycle: 'app-api:open_inspection_cycle',
      create_cost_record: 'app-api:create_cost_record',
      save_official_vehicle: 'app-api:save_official_vehicle',
      save_floor_model: 'app-api:save_floor_model',
    workorder_list: 'app-api:workorder_list',
    workorder_prepare_upload: 'app-api:workorder_prepare_upload',
    workorder_options: 'app-api:workorder_options',
    workorder_detail: 'app-api:workorder_detail',
    workorder_create_request: 'app-api:workorder_create_request',
    workorder_workflow: 'app-api:workorder_workflow',
  } as Record<string, string>)[action];
    if (actionScope) {
      const { data: actionRateAllowed, error: actionRateError } = await admin.rpc('enforce_request_rate_limit', {
        p_subject: authData.user.id,
        p_scope: actionScope,
      });
      if (actionRateError) {
        console.error(`${actionScope} rate limit failed:`, actionRateError.message);
        return reply(req, { ok: false, message: '安全限流服務暫時無法使用' }, 503);
      }
      if (actionRateAllowed !== true) {
        return reply(req, { ok: false, message: '請求過於頻繁，請稍後再試' }, 429);
      }
    }

    if (action === 'profile') {
      return reply(req, { ok: true, data: { ...profile, email: profile.email || authData.user.email || '', allowed_systems: isSysadmin ? ['*'] : [...allowedSystems] } });
    }

    if (action === 'update_personal_profile') {
      const name = text(body.name, 100);
      const phone = text(body.phone, 40);
      if (name.length < 2) return reply(req, { ok: false, message: '姓名至少需要 2 個字元' }, 400);
      if (phone && !/^[0-9()#+*\-\s]{4,40}$/.test(phone)) return reply(req, { ok: false, message: '聯絡電話格式不正確' }, 400);
      const before = { name: profile.name, phone: profile.phone || null };
      const { data: updated, error } = await admin.from('users')
        .update({ name, phone: phone || null })
        .eq('user_id', profile.user_id).eq('status', 'active')
        .select('user_id,username,email,name,phone,department,role,rbac_role,status').single();
      if (error || !updated) return reply(req, { ok: false, message: '個人資料更新失敗' }, 500);
      await writeAudit(admin, profile.user_id, 'users', profile.user_id, 'update', before, { name: updated.name, phone: updated.phone });
      return reply(req, { ok: true, data: { ...updated, email: updated.email || authData.user.email || '', allowed_systems: isSysadmin ? ['*'] : [...allowedSystems] } });
    }

    if (action === 'module_data') {
      const systemKey=text(body.system,40),moduleKey=text(body.module,40);
      const config=MODULE_SOURCES[`${systemKey}/${moduleKey}`];
      if(!config)return reply(req,{ok:false,message:'找不到指定的 V2 子系統'},404);
      if(!can(config.permission))return reply(req,{ok:false,message:'目前角色沒有此系統權限'},403);
      const selectColumns=config.columns.map(column=>column[0]);
      if(systemKey==='guardpatrol'&&moduleKey==='records'){
        selectColumns.push('equipment(name)','users!inspection_records_inspector_id_fkey(name)');
      }
      // API 不提供整表下載；畫面分頁仍由前端保留，但單次回傳最多 100 筆。
      let query=userDb.from(config.table).select(selectColumns.join(',')).limit(100);
      if(config.filter)query=query.eq(config.filter[0],config.filter[1]);
      if(config.order)query=query.order(config.order,{ascending:false});
      const {data,error}=await query;
      if(error){console.error('module_data query failed',config.table,error.message);return reply(req,{ok:false,message:`${config.title}資料讀取失敗`},500);}
      const rows=((data||[]) as unknown as Array<Record<string,unknown>>).map(row=>{
        if(systemKey!=='guardpatrol'||moduleKey!=='records')return row;
        const equipmentName=relationName(row.equipment);
        const inspectorName=relationName(row.users);
        return {...row,equipment_id:equipmentName||row.equipment_id,inspector_id:inspectorName||row.inspector_id};
      });
      const statusCounts=new Map<string,number>();
      rows.forEach(row=>{const status=text(row.status||row.run_status,50);if(status)statusCounts.set(status,(statusCounts.get(status)||0)+1)});
      const summary=[{label:'目前資料',value:rows.length},...[...statusCounts.entries()].slice(0,3).map(([label,value])=>({label,value}))];
      return reply(req,{ok:true,data:{title:config.title,table:config.table,columns:config.columns.map(([key,label])=>({key,label})),rows,summary}});
    }

    if (action === 'workorder_list') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const moduleKey = text(body.module, 20);
      if (!['requests', 'dispatch', 'orders'].includes(moduleKey)) {
        return reply(req, { ok: false, message: '維修子系統參數無效' }, 400);
      }
      const requests = await userDb.from('repair_requests').select('*')
        .order('updated_at', { ascending: false }).limit(500);
      if (requests.error) throw requests.error;
      let rows = (requests.data || []) as Array<Record<string, unknown>>;
      if (moduleKey !== 'requests' && rows.length) {
        const requestIds = rows.map(row => text(row.request_id, 80)).filter(Boolean);
        const orders = requestIds.length
          ? await userDb.from('maintenance_orders')
              .select('order_id,request_id,assignee_id,status,created_at')
              .in('request_id', requestIds).order('created_at', { ascending: false }).limit(1000)
          : { data: [], error: null };
        if (orders.error) throw orders.error;
        const latestOrders = new Map<string, Record<string, unknown>>();
        for (const order of (orders.data || []) as Array<Record<string, unknown>>) {
          const requestId = text(order.request_id, 80);
          if (requestId && !latestOrders.has(requestId)) latestOrders.set(requestId, order);
        }
        const assigneeIds = [...new Set([...latestOrders.values()].map(order => text(order.assignee_id, 80)).filter(Boolean))];
        const people = assigneeIds.length
          ? await userDb.from('users').select('user_id,name').in('user_id', assigneeIds)
          : { data: [], error: null };
        if (people.error) throw people.error;
        const names = new Map((people.data || []).map(person => [String(person.user_id), text(person.name, 100)]));
        rows = rows.map(row => {
          const order = latestOrders.get(text(row.request_id, 80));
          const assigneeId = text(order?.assignee_id || row.assignee_id, 80);
          return {
            ...row,
            order_id: order?.order_id || null,
            order_status: order?.status || null,
            assignee_id: assigneeId || null,
            assignee_name: names.get(assigneeId) || '',
          };
        });
      }
      const statusCounts = new Map<string, number>();
      rows.forEach(row => {
        const status = text(row.status, 50);
        if (status) statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      });
      const titles: Record<string, string> = { requests: '報修案件', dispatch: '派工作業', orders: '維修工單' };
      return reply(req, { ok: true, data: {
        title: titles[moduleKey],
        table: 'repair_requests',
        rows,
        summary: [{ label: '目前資料', value: rows.length }, ...[...statusCounts.entries()].slice(0, 3).map(([label, value]) => ({ label, value }))],
      } });
    }

    if (action === 'workorder_options') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const [people, equipment, departments, contact] = await Promise.all([
        userDb.from('users').select('user_id,name,department,role,rbac_role').eq('status', 'active').order('name').limit(500),
        userDb.from('equipment').select('equipment_id,name,asset_code,location,category').neq('status', 'retired').order('name').limit(500),
        userDb.from('departments').select('name').eq('status', 'active').order('sort_order').limit(200),
        userDb.from('users').select('phone,department').eq('user_id', profile.user_id).maybeSingle(),
      ]);
      if (people.error) throw people.error;
      if (equipment.error) throw equipment.error;
      if (departments.error) throw departments.error;
      if (contact.error) throw contact.error;
      const technicians = (people.data || []).filter(row => {
        const role = text(row.rbac_role || row.role, 40);
        return role === 'technician' || role === 'maintenance';
      }).map(row => ({
        user_id: String(row.user_id),
        name: text(row.name, 100),
        department: text(row.department, 100) || null,
      })).filter(row => row.user_id && row.name);
      return reply(req, { ok: true, data: {
        technicians,
        equipment: equipment.data || [],
        departments: (departments.data || []).map(row => text(row.name, 100)).filter(Boolean),
        contact: {
          phone: text(contact.data?.phone, 40),
          department: text(contact.data?.department || profile.department, 100),
        },
      } });
    }

    if (action === 'workorder_detail') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const requestId = text(body.request_id, 80);
      const requestNo = text(body.req_no, 80);
      if (requestId && !/^[0-9a-f-]{36}$/i.test(requestId)) return reply(req, { ok: false, message: '報修案件識別碼無效' }, 400);
      if (!requestId && !requestNo) return reply(req, { ok: false, message: '找不到報修案件識別碼' }, 400);
      let requestQuery = userDb.from('repair_requests').select('*,equipment(name,category,qr_code)');
      requestQuery = requestId ? requestQuery.eq('request_id', requestId) : requestQuery.eq('req_no', requestNo);
      const requestResult = await requestQuery.limit(1).maybeSingle();
      if (requestResult.error) throw requestResult.error;
      if (!requestResult.data) return reply(req, { ok: false, message: '找不到這筆報修案件' }, 404);
      const fullRequestId = String(requestResult.data.request_id);
      const [orderResult, attachmentsResult, logsResult] = await Promise.all([
        userDb.from('maintenance_orders').select('*,users:assignee_id(name)').eq('request_id', fullRequestId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        userDb.from('repair_attachments').select('*').eq('request_id', fullRequestId).order('uploaded_at', { ascending: true }),
        userDb.from('case_status_log').select('*').eq('request_id', fullRequestId).order('created_at', { ascending: true }),
      ]);
      const warnings: string[] = [];
      if (orderResult.error) warnings.push(`維修工單：${text(orderResult.error.message, 300)}`);
      if (attachmentsResult.error) warnings.push(`附件：${text(attachmentsResult.error.message, 300)}`);
      if (logsResult.error) warnings.push(`處理歷程：${text(logsResult.error.message, 300)}`);
      const attachments = ((attachmentsResult.data || []) as Array<Record<string, unknown>>).map(item => ({ ...item }));
      if (attachments.length) {
        const paths = attachments.map(item => text(item.file_path, 1000)).filter(Boolean);
        const signedResult = await userDb.storage.from('repair-files').createSignedUrls(paths, 3600);
        if (signedResult.error) warnings.push(`附件網址：${text(signedResult.error.message, 300)}`);
        const signedMap = new Map((signedResult.data || []).map(item => [item.path, item.signedUrl]));
        attachments.forEach(item => { item.signed_url = signedMap.get(text(item.file_path, 1000)) || ''; });
      }
      return reply(req, { ok: true, data: {
        request: requestResult.data,
        order: orderResult.data || null,
        attachments,
        logs: logsResult.data || [],
        warnings,
      } });
    }

    if (action === 'workorder_prepare_upload') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const reqBody = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const requestPayload = reqBody.request && typeof reqBody.request === 'object' && !Array.isArray(reqBody.request)
        ? reqBody.request as Record<string, unknown>
        : {};
      const locationPhoto = reqBody.location_photo && typeof reqBody.location_photo === 'object' && !Array.isArray(reqBody.location_photo)
        ? reqBody.location_photo as Record<string, unknown>
        : {};
      const equipmentPhoto = reqBody.equipment_photo && typeof reqBody.equipment_photo === 'object' && !Array.isArray(reqBody.equipment_photo)
        ? reqBody.equipment_photo as Record<string, unknown>
        : {};
      const locationFileName = text(locationPhoto.name, 200);
      const equipmentFileName = text(equipmentPhoto.name, 200);
      const locationFileType = text(locationPhoto.type, 80).toLowerCase();
      const equipmentFileType = text(equipmentPhoto.type, 80).toLowerCase();
      if (!locationFileName || !equipmentFileName) return reply(req, { ok: false, message: '照片檔名不可為空' }, 400);
      if (!/^(image\/(?:jpeg|png|webp|heic))$/i.test(locationFileType) || !/^(image\/(?:jpeg|png|webp|heic))$/i.test(equipmentFileType)) {
        return reply(req, { ok: false, message: '照片類型必須是 JPEG、PNG、WebP 或 HEIC' }, 400);
      }
      const locationFileSize = Number(locationPhoto.size);
      const equipmentFileSize = Number(equipmentPhoto.size);
      if (!Number.isFinite(locationFileSize) || locationFileSize <= 0 || locationFileSize > 10 * 1024 * 1024) return reply(req, { ok: false, message: '故障位置照片大小限制 10MB' }, 400);
      if (!Number.isFinite(equipmentFileSize) || equipmentFileSize <= 0 || equipmentFileSize > 10 * 1024 * 1024) return reply(req, { ok: false, message: '維修設備照片大小限制 10MB' }, 400);

      const requestId = nextRequestRequestId();
      const reqNoResult = await admin.rpc('gen_req_no');
      if (reqNoResult.error || !reqNoResult.data) return reply(req, { ok: false, message: '無法產生報修單號，請稍後再試' }, 503);
      const reqNo = text(reqNoResult.data, 40);
      const requestSnapshot = {
        request_id: requestId,
        req_no: reqNo,
        source: 'app-api',
        reporter: text(requestPayload.reporter, 100) || profile.name,
        phone: text(requestPayload.phone, 40) || null,
        department: text(requestPayload.department, 100) || text(profile.department, 100) || null,
        equipment_id: /^[0-9a-f-]{36}$/i.test(text(requestPayload.equipment_id, 80)) ? text(requestPayload.equipment_id, 80) : null,
        equipment_category: text(requestPayload.equipment_category, 120) || null,
        fault_location: text(requestPayload.fault_location, 200) || null,
        fault_type: text(requestPayload.fault_type, 80) || null,
        urgency: text(requestPayload.urgency, 20) || 'normal',
        fault_desc: text(requestPayload.fault_desc, 2000),
        mobile: text(requestPayload.mobile, 40) || null,
        status: 'pending',
        created_by: profile.user_id,
      };
      if (!requestSnapshot.req_no) return reply(req, { ok: false, message: '無法建立報修單號，請稍後再試' }, 500);
      if (!requestSnapshot.fault_desc) return reply(req, { ok: false, message: '故障描述不可空白' }, 400);
      if (!requestSnapshot.mobile) return reply(req, { ok: false, message: '手機號碼為必填欄位' }, 400);

      const locationPath = `${requestId}/location_${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${extractFileExt(locationFileName, 'jpg')}`;
      const equipmentPath = `${requestId}/equipment_${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${extractFileExt(equipmentFileName, 'jpg')}`;
      const [locationUpload, equipmentUpload] = await Promise.all([
        admin.storage.from('repair-files').createSignedUploadUrl(locationPath, 15 * 60),
        admin.storage.from('repair-files').createSignedUploadUrl(equipmentPath, 15 * 60),
      ]);

      if (locationUpload.error || !locationUpload.data || !locationUpload.data.path || !locationUpload.data.token) {
        return reply(req, { ok: false, message: text(locationUpload.error?.message, 300) || '故障位置照片上傳授權建立失敗' }, 500);
      }
      if (equipmentUpload.error || !equipmentUpload.data || !equipmentUpload.data.path || !equipmentUpload.data.token) {
        return reply(req, { ok: false, message: text(equipmentUpload.error?.message, 300) || '維修設備照片上傳授權建立失敗' }, 500);
      }

      return reply(req, { ok: true, data: {
        request_snapshot: requestSnapshot,
        uploads: {
          location: {
            path: locationUpload.data.path,
            token: locationUpload.data.token,
          },
          equipment: {
            path: equipmentUpload.data.path,
            token: equipmentUpload.data.token,
          },
        },
      } });
    }

    if (action === 'workorder_create_request') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const reqBody = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const requestData = reqBody.request && typeof reqBody.request === 'object' && !Array.isArray(reqBody.request)
        ? reqBody.request as Record<string, unknown>
        : {};
      const requestId = text(requestData.request_id, 80);
      const reqNo = text(requestData.req_no, 80);
      const locationPath = text(reqBody.location_file_path, 1000);
      const equipmentPath = text(reqBody.equipment_file_path, 1000);
      const locationFileName = text(reqBody.location_file_name, 120);
      const equipmentFileName = text(reqBody.equipment_file_name, 120);
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return reply(req, { ok: false, message: '報修案件識別碼無效' }, 400);
      if (!reqNo) return reply(req, { ok: false, message: '報修單號不可為空' }, 400);
      if (!locationPath || !equipmentPath) return reply(req, { ok: false, message: '上傳檔案資訊不完整' }, 400);
      if (!locationPath.startsWith(`${requestId}/`) || !equipmentPath.startsWith(`${requestId}/`)) return reply(req, { ok: false, message: '上傳檔案路徑不符案件' }, 400);
      if (!locationFileName || !equipmentFileName) return reply(req, { ok: false, message: '上傳檔名不完整' }, 400);

      const uploadedList = await admin.storage.from('repair-files').list(requestId);
      if (uploadedList.error) return reply(req, { ok: false, message: text(uploadedList.error.message, 300) || '驗證附件上傳結果失敗' }, 503);
      const uploadedSet = new Set((uploadedList.data || []).map(item => text((item as { name: string }).name, 500)));
      const uploadedLocationFile = locationPath.split('/').pop();
      const uploadedEquipmentFile = equipmentPath.split('/').pop();
      if (!uploadedSet.has(uploadedLocationFile || '') || !uploadedSet.has(uploadedEquipmentFile || '')) {
        return reply(req, { ok: false, message: '附件尚未完成上傳，請重新上傳' }, 409);
      }

      const [existingRequest] = await Promise.all([
        admin.from('repair_requests').select('request_id').eq('request_id', requestId).maybeSingle(),
      ]);
      if (existingRequest.error) return reply(req, { ok: false, message: text(existingRequest.error.message, 300) || '檢查現有資料失敗' }, 500);
      if (existingRequest.data) return reply(req, { ok: false, message: '此報修案件已提交，請勿重複送出' }, 409);

      const [existingReqNo] = await Promise.all([
        admin.from('repair_requests').select('request_id').eq('req_no', reqNo).maybeSingle(),
      ]);
      if (existingReqNo.error) return reply(req, { ok: false, message: text(existingReqNo.error.message, 300) || '檢查報修單號失敗' }, 500);
      if (existingReqNo.data) return reply(req, { ok: false, message: '報修單號重複，請稍後再試' }, 409);

      const requestRow = {
        request_id: requestId,
        req_no: reqNo,
        source: 'app-api',
        reporter: text(requestData.reporter, 100) || profile.name,
        phone: text(requestData.phone, 40) || null,
        department: text(requestData.department, 100) || text(profile.department, 100) || null,
        equipment_id: /^[0-9a-f-]{36}$/i.test(text(requestData.equipment_id, 80)) ? text(requestData.equipment_id, 80) : null,
        equipment_category: text(requestData.equipment_category, 120) || null,
        fault_location: text(requestData.fault_location, 200) || null,
        fault_type: text(requestData.fault_type, 80) || null,
        urgency: text(requestData.urgency, 20) || 'normal',
        fault_desc: text(requestData.fault_desc, 2000),
        mobile: text(requestData.mobile, 40) || null,
        status: 'pending',
        created_by: profile.user_id,
      };
      const attachmentsRows = [
        { request_id: requestId, kind: 'location_photo', file_path: locationPath, file_name: locationFileName, uploaded_by: profile.user_id },
        { request_id: requestId, kind: 'equipment_photo', file_path: equipmentPath, file_name: equipmentFileName, uploaded_by: profile.user_id },
      ];
      const logRow = {
        request_id: requestId,
        order_id: null,
        from_status: null,
        to_status: 'pending',
        note: '報修人建立報修',
        operator_id: profile.user_id,
        operator_name: profile.name,
      };
      const createResponse = await admin.from('repair_requests').insert(requestRow).select('request_id,req_no').single();
      if (createResponse.error) {
        await admin.storage.from('repair-files').remove([locationPath, equipmentPath]);
        return reply(req, { ok: false, message: text(createResponse.error.message, 300) || '建立報修失敗' }, 400);
      }
      const created = createResponse.data;

      const initLog = await admin.from('case_status_log').insert(logRow);
      if (initLog.error) {
        await admin.storage.from('repair-files').remove([locationPath, equipmentPath]);
        await admin.from('repair_requests').delete().eq('request_id', requestId);
        return reply(req, { ok: false, message: text(initLog.error.message, 300) || '建立歷程失敗' }, 400);
      }

      const attachmentInsert = await admin.from('repair_attachments').insert(attachmentsRows).select('attach_id').limit(10);
      if (attachmentInsert.error) {
        await admin.storage.from('repair-files').remove([locationPath, equipmentPath]);
        await admin.from('repair_requests').delete().eq('request_id', requestId);
        await admin.from('case_status_log').delete().eq('request_id', requestId);
        return reply(req, { ok: false, message: text(attachmentInsert.error.message, 300) || '建立附件失敗' }, 400);
      }

      return reply(req, { ok: true, data: created });
    }

    if (action === 'workorder_workflow') {
      if (!can('workorder')) return reply(req, { ok: false, message: '目前角色沒有維修系統權限' }, 403);
      const requestId = text(body.request_id, 80);
      const workflowAction = text(body.workflow_action, 40);
      const allowedActions = new Set(['dispatch', 'engineer_accept', 'engineer_start', 'engineer_complete', 'reporter_accept', 'supervisor_accept', 'cancel']);
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return reply(req, { ok: false, message: '報修案件識別碼無效' }, 400);
      if (!allowedActions.has(workflowAction)) return reply(req, { ok: false, message: '維修流程動作無效' }, 400);
      const rawPayload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload as Record<string, unknown>
        : {};
      const payload: Record<string, unknown> = {};
      if (workflowAction === 'dispatch') {
        const technician = text(rawPayload.technician, 80);
        if (technician && !/^[0-9a-f-]{36}$/i.test(technician)) return reply(req, { ok: false, message: '維修人員識別碼無效' }, 400);
        payload.technician = technician || null;
        payload.vendor = text(rawPayload.vendor, 200) || null;
        for (const key of ['expected_arrival', 'expected_finish'] as const) {
          const value = text(rawPayload[key], 40);
          if (value && Number.isNaN(Date.parse(value))) return reply(req, { ok: false, message: '派工日期時間格式無效' }, 400);
          payload[key] = value || null;
        }
        payload.work_content = text(rawPayload.work_content, 1000) || null;
        payload.need_shutdown = rawPayload.need_shutdown === true;
        payload.need_approval = rawPayload.need_approval === true;
      } else if (workflowAction === 'engineer_complete') {
        payload.fault_cause = text(rawPayload.fault_cause, 1000);
        payload.handle_method = text(rawPayload.handle_method, 2000);
        payload.parts_used = text(rawPayload.parts_used, 1000) || null;
        payload.materials = text(rawPayload.materials, 1000) || null;
        const laborHours = rawPayload.labor_hours === null || rawPayload.labor_hours === '' ? null : Number(rawPayload.labor_hours);
        if (laborHours !== null && (!Number.isFinite(laborHours) || laborHours < 0 || laborHours > 100000)) {
          return reply(req, { ok: false, message: '工時必須是零以上的數字' }, 400);
        }
        payload.labor_hours = laborHours;
        payload.note = text(rawPayload.note, 1000) || null;
      }
      const { data, error } = await userDb.rpc('apply_repair_workflow', {
        p_request_id: requestId,
        p_action: workflowAction,
        p_payload: payload,
      });
      if (error) return reply(req, { ok: false, message: text(error.message, 500) || '維修流程更新失敗' }, 400);
      return reply(req, { ok: true, data });
    }

    if (action === 'dashboard') {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [equipment, inspections, abnormal, openRepairs, trendResult, repairsResult, recentResult] = await Promise.all([
        countQuery(userDb.from('equipment').select('*', { count: 'exact', head: true }).neq('status', 'retired')),
        countQuery(userDb.from('inspection_records').select('*', { count: 'exact', head: true }).gte('inspect_time', since)),
        countQuery(userDb.from('inspection_records').select('*', { count: 'exact', head: true }).gte('inspect_time', since).eq('run_status', 'abnormal')),
        countQuery(userDb.from('repair_requests').select('*', { count: 'exact', head: true }).neq('status', 'closed')),
        userDb.from('inspection_records').select('record_id,inspect_time,run_status').gte('inspect_time', since).order('inspect_time').limit(5000),
        userDb.from('repair_requests').select('request_id,req_no,fault_location,status,created_at').order('created_at', { ascending: false }).limit(8),
        userDb.from('inspection_records').select('record_id,inspect_time,run_status,equipment(name)').order('inspect_time', { ascending: false }).limit(8),
      ]);
      const buckets = new Map<string, { date: string; total: number; abnormal: number }>();
      for (let offset = 29; offset >= 0; offset--) {
        const date = new Date(Date.now() - offset * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        buckets.set(date, { date, total: 0, abnormal: 0 });
      }
      for (const row of trendResult.data || []) {
        const date = new Date(row.inspect_time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        const bucket = buckets.get(date);
        if (bucket) { bucket.total += 1; if (row.run_status === 'abnormal') bucket.abnormal += 1; }
      }
      const recentInspections = (recentResult.data || []).map((row) => ({
        ...row,
        equipment_name: Array.isArray(row.equipment) ? row.equipment[0]?.name : (row.equipment as { name?: string } | null)?.name,
      }));
      return reply(req, { ok: true, data: {
        metrics: { equipment, inspections, abnormal, open_repairs: openRepairs, completion_rate: inspections ? Math.round((inspections - abnormal) / inspections * 1000) / 10 : 100 },
        inspection_trend: [...buckets.values()], recent_repairs: repairsResult.data || [], recent_inspections: recentInspections,
      } });
    }

    if (action === 'inspections') {
      if (!can('guardpatrol')) return reply(req, { ok: false, message: '目前角色沒有巡檢系統權限' }, 403);
      const [records, equipment] = await Promise.all([
        userDb.from('inspection_records').select('record_id,inspect_time,run_status,light_status,abnormal_note,location_point,equipment(name,asset_code,floor),users!inspection_records_inspector_id_fkey(name)').order('inspect_time', { ascending: false }).limit(200),
        userDb.from('equipment').select('equipment_id,name,asset_code,floor').neq('status', 'retired').order('name').limit(1000),
      ]);
      if (records.error) throw records.error;
      if (equipment.error) throw equipment.error;
      return reply(req, { ok: true, data: { rows: records.data || [], equipment: equipment.data || [] } });
    }

    if (action === 'create_inspection') {
      if (!can('guardpatrol')) return reply(req, { ok: false, message: '目前角色沒有新增巡檢權限' }, 403);
      const equipmentId = text(body.equipment_id, 80);
      const runStatus = body.run_status === 'abnormal' ? 'abnormal' : 'normal';
      if (!/^[0-9a-f-]{36}$/i.test(equipmentId)) return reply(req, { ok: false, message: '請選擇有效設備' }, 400);
      const abnormalNote = text(body.abnormal_note, 1000);
      if (runStatus === 'abnormal' && !abnormalNote) return reply(req, { ok: false, message: '異常巡檢必須填寫說明' }, 400);
      const { data, error } = await userDb.from('inspection_records').insert({
        equipment_id: equipmentId, inspector_id: profile.user_id, run_status: runStatus,
        light_status: runStatus === 'abnormal' ? 'red' : 'green',
        location_point: text(body.location_point, 240) || null, abnormal_note: abnormalNote || null,
      }).select('record_id').single();
      if (error) throw error;
      return reply(req, { ok: true, data });
    }

    if (action === 'open_inspection_cycle') {
      if (!isAdmin || !can('guardpatrol')) return reply(req, { ok: false, message: '只有巡檢系統管理者可以開啟週期' }, 403);
      const cycleType = text(body.cycle_type, 20);
      if (!['daily', 'shift', 'weekly'].includes(cycleType)) return reply(req, { ok: false, message: '週期類型無效' }, 400);
      const { data, error } = await userDb.rpc('open_inspection_cycle', { p_cycle_type: cycleType });
      if (error) throw error;
      return reply(req, { ok: true, data: { cycle_id: data } });
    }

    if (action === 'create_cost_record') {
      if (!can('workorder') || !isAdmin) {
        return reply(req, { ok: false, message: '目前角色沒有新增費用權限' }, 403);
      }
      const equipmentId = text(body.equipment_id, 80);
      const costType = text(body.cost_type, 20);
      const vendor = text(body.vendor, 200) || null;
      const note = text(body.note, 1000) || null;
      const costDate = text(body.cost_date, 10);
      const amount = Number(body.amount);
      if (!/^[0-9a-f-]{36}$/i.test(equipmentId)) return reply(req, { ok: false, message: '設備識別碼無效' }, 400);
      if (!['purchase', 'outsource', 'parts', 'labor', 'other'].includes(costType)) return reply(req, { ok: false, message: '費用類型無效' }, 400);
      if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999) return reply(req, { ok: false, message: '金額必須介於 0 至 9,999,999,999' }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(costDate)) return reply(req, { ok: false, message: '日期格式無效' }, 400);
      const { data, error } = await userDb.from('cost_records').insert({
        equipment_id: equipmentId, cost_type: costType, vendor, cost_date: costDate,
        amount, note, created_by: profile.user_id,
      }).select('cost_id').single();
      if (error) throw error;
      return reply(req, { ok: true, data });
    }

    if (action === 'save_official_vehicle') {
      if (!can('vehicle')) return reply(req, { ok: false, message: '目前角色沒有車輛主檔權限' }, 403);
      const isFleetManager = isAdmin || (await userDb.from('vehicle_dispatch_managers').select('user_id').eq('user_id', profile.user_id).eq('active', true).maybeSingle()).data;
      if (!isFleetManager) return reply(req, { ok: false, message: '只有派車管理者可以維護車輛主檔' }, 403);
      const vehicleId = text(body.vehicle_id, 80);
      const plateNo = text(body.plate_no, 40);
      const seats = Number(body.seats);
      const odometer = Number(body.current_odometer);
      if (!plateNo || !Number.isInteger(seats) || seats < 1 || seats > 100 || !Number.isFinite(odometer) || odometer < 0 || odometer > 999999999) {
        return reply(req, { ok: false, message: '車號、座位數或里程資料無效' }, 400);
      }
      const payload = {
        plate_no: plateNo, vehicle_name: text(body.vehicle_name, 120) || null,
        brand: text(body.brand, 120) || null, model: text(body.model, 120) || null,
        seats, current_odometer: odometer, status: body.status === 'inactive' ? 'inactive' : 'active',
        note: text(body.note, 1000) || null,
      };
      if (vehicleId) {
        if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(req, { ok: false, message: '車輛識別碼無效' }, 400);
        const { data, error } = await userDb.from('official_vehicles').update(payload).eq('vehicle_id', vehicleId).select('vehicle_id').maybeSingle();
        if (error) throw error;
        if (!data) return reply(req, { ok: false, message: '找不到車輛' }, 404);
        return reply(req, { ok: true, data: { vehicle_id: vehicleId, created: false } });
      }
      const { data, error } = await userDb.from('official_vehicles').insert({ ...payload, created_by: profile.user_id }).select('vehicle_id').single();
      if (error) throw error;
      return reply(req, { ok: true, data: { vehicle_id: data.vehicle_id, created: true } });
    }

    if (action === 'equipment_map') {
      if (!can('structuremap') && !can('equipment')) return reply(req, { ok: false, message: '目前角色沒有設備圖臺權限' }, 403);
      const [equipment, markers, locations] = await Promise.all([
        userDb.from('equipment').select('equipment_id,name,asset_code,category,status,floor,location,location_id').order('floor').order('name').limit(2000),
        userDb.from('plan_markers').select('marker_id,equipment_id,floor,x,y,label').limit(5000),
        userDb.from('locations').select('location_id,name,floor').limit(2000),
      ]);
      if (equipment.error) throw equipment.error;
      return reply(req, { ok: true, data: {
        equipment: (equipment.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
        markers: markers.error ? [] : (markers.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
        locations: locations.error ? [] : (locations.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
      } });
    }

    if (action === 'save_floor_model') {
      if (!can('structuremap')) return reply(req, { ok: false, message: '目前角色沒有設備圖臺權限' }, 403);
      const floorId = text(body.floor_id, 20).toUpperCase().replace(/\s+/g, '');
      const name = text(body.name, 100);
      const imagePath = text(body.image_path, 100);
      const bboxSource = body.bbox && typeof body.bbox === 'object' ? body.bbox as Record<string, unknown> : {};
      const bbox = {
        mnx: Number(bboxSource.mnx), mny: Number(bboxSource.mny),
        mxx: Number(bboxSource.mxx), mxy: Number(bboxSource.mxy),
        w: Number(bboxSource.w), h: Number(bboxSource.h),
      };
      if (!/^[A-Z0-9_-]{1,20}$/.test(floorId)) return reply(req, { ok: false, message: '樓層代號格式無效' }, 400);
      if (!name) return reply(req, { ok: false, message: '樓層名稱不可空白' }, 400);
      if (imagePath !== `${floorId}.png`) return reply(req, { ok: false, message: '模型檔案路徑無效' }, 400);
      if (Object.values(bbox).some(value => !Number.isFinite(value)) || bbox.w <= 0 || bbox.h <= 0) {
        return reply(req, { ok: false, message: '模型繪圖範圍無效' }, 400);
      }
      const { data: before, error: readError } = await userDb.from('floor_models')
        .select('floor_id,name,image_path,bbox,updated_at').eq('floor_id', floorId).maybeSingle();
      if (readError) throw readError;
      const payload = { floor_id: floorId, name, image_path: imagePath, bbox, updated_at: new Date().toISOString() };
      const { data, error } = await userDb.from('floor_models').upsert(payload, { onConflict: 'floor_id' }).select('floor_id').single();
      if (error) throw error;
      await writeAudit(userDb, profile.user_id, 'floor_models', floorId, before ? 'update' : 'insert', before, payload);
      return reply(req, { ok: true, data });
    }

    // ---- SYS-08 會議室預約 ----------------------------------------------
    // 鏡射 public.is_admin()：role='admin' 或 rbac_role in ('admin','sysadmin')。
    // profile 查詢已限定 status='active'，故此處不必再判斷。
    if (action === 'meeting_check_in') {
      if (!can('meetingroom')) return reply(req, { ok: false, message: '目前角色沒有會議室系統權限' }, 403);
      const bookingId = text(body.booking_id, 80);
      if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return reply(req, { ok: false, message: '預約識別碼無效' }, 400);

      const { data: booking, error: readError } = await userDb.from('meeting_bookings')
        .select('booking_id,status,booking_date,start_time,end_time').eq('booking_id', bookingId).maybeSingle();
      if (readError) throw readError;
      if (!booking) return reply(req, { ok: false, message: '找不到這筆預約' }, 404);
      if (booking.status !== 'booked') return reply(req, { ok: false, message: '這筆預約目前狀態不可報到' }, 409);

      // 報到時段檢查原本只存在於 V1 前端（canCheckIn），資料庫沒有這道約束。
      // 這裡明確以 Asia/Taipei (+08:00) 解析，不依賴函式執行環境的時區。
      const now = Date.now();
      const startAt = Date.parse(`${booking.booking_date}T${booking.start_time}+08:00`);
      const endAt = Date.parse(`${booking.booking_date}T${booking.end_time}+08:00`);
      if (Number.isNaN(startAt) || Number.isNaN(endAt)) return reply(req, { ok: false, message: '預約時間資料異常' }, 409);
      if (now < startAt || now > endAt) return reply(req, { ok: false, message: '目前不在會議時段內，無法報到' }, 409);

      // 併帶 status 條件，避免兩個分頁同時按下造成重複報到。
      const { data: updated, error } = await userDb.from('meeting_bookings')
        .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
        .eq('booking_id', bookingId).eq('status', 'booked').select('booking_id').maybeSingle();
      if (error) throw error;
      if (!updated) return reply(req, { ok: false, message: '這筆預約已被處理，請重新整理' }, 409);

      await writeAudit(userDb, profile.user_id, 'meeting_bookings', bookingId, 'update',
        { status: booking.status }, { status: 'checked_in' });
      return reply(req, { ok: true, data: { booking_id: bookingId, status: 'checked_in' } });
    }

    if (action === 'meeting_save_room') {
      if (!can('meetingroom')) return reply(req, { ok: false, message: '目前角色沒有會議室系統權限' }, 403);
      if (!isAdmin) return reply(req, { ok: false, message: '只有管理者可以維護會議室主檔' }, 403);

      const name = text(body.name, 120);
      if (!name) return reply(req, { ok: false, message: '請輸入會議室名稱' }, 400);
      const status = body.status === 'inactive' ? 'inactive' : 'active';
      const floor = text(body.floor, 40) || null;
      const note = text(body.note, 500) || null;
      let capacity: number | null = null;
      if (body.capacity !== null && body.capacity !== undefined && body.capacity !== '') {
        const parsed = Number(body.capacity);
        if (!Number.isInteger(parsed) || parsed < 0) return reply(req, { ok: false, message: '容量請填 0 以上的整數' }, 400);
        capacity = parsed;
      }
      const payload = { name, capacity, floor, status, note };

      const roomId = text(body.room_id, 80);
      if (roomId) {
        if (!/^[0-9a-f-]{36}$/i.test(roomId)) return reply(req, { ok: false, message: '會議室識別碼無效' }, 400);
        const { data: before, error: readError } = await userDb.from('meeting_rooms')
          .select('room_id,name,capacity,floor,status,note').eq('room_id', roomId).maybeSingle();
        if (readError) throw readError;
        if (!before) return reply(req, { ok: false, message: '找不到這間會議室' }, 404);
        const { error } = await userDb.from('meeting_rooms').update(payload).eq('room_id', roomId);
        if (error) throw error;
        await writeAudit(userDb, profile.user_id, 'meeting_rooms', roomId, 'update', before, payload);
        return reply(req, { ok: true, data: { room_id: roomId, created: false } });
      }

      const { data, error } = await userDb.from('meeting_rooms')
        .insert({ ...payload, created_by: profile.user_id }).select('room_id').single();
      if (error) throw error;
      await writeAudit(userDb, profile.user_id, 'meeting_rooms', data.room_id, 'insert', null, payload);
      return reply(req, { ok: true, data: { room_id: data.room_id, created: true } });
    }

    return reply(req, { ok: false, message: '不支援的 API 動作' }, 400);
  } catch (error) {
    console.error('app-api failed', error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: 'API 處理失敗，請稍後再試' }, 500);
  }
}

// Supabase Edge Functions continue to use this adapter during the migration.
// The Node.js service imports the same handler, so authentication and business
// rules remain identical in both runtimes.
if (denoRuntime?.serve) denoRuntime.serve(handleAppApiRequest);
