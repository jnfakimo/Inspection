import { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import { configurationError } from "./src/config";
import {
  matchesRegisteredDevice,
  scanNearbyDevices,
  stopBleManager,
} from "./src/ble";
import {
  startBackgroundTracking,
  stopBackgroundTracking,
} from "./src/background-location";
import { supabase } from "./src/supabase";
import { flushLocationQueue } from "./src/sync";
import {
  readActiveSession,
  readLocationQueue,
  writeActiveSession,
} from "./src/storage";
import type {
  ActiveTrackingSession,
  NearbyBleDevice,
  TrackingDevice,
  Vehicle,
} from "./src/types";

type Profile = { user_id: string; name: string };

const zhError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.trim() : "";
  return message && /[\u3400-\u9fff]/.test(message) ? message : fallback;
};

export default function App() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]),
    [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [vehicleId, setVehicleId] = useState(""),
    [deviceId, setDeviceId] = useState("");
  const [nearby, setNearby] = useState<NearbyBleDevice[]>([]),
    [matchedBleId, setMatchedBleId] = useState("");
  const [active, setActive] = useState<ActiveTrackingSession | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState(0);
  const [queued, setQueued] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");

  const selectedDevice =
    devices.find((device) => device.device_id === deviceId) || null;
  const vehicleDevices = useMemo(
    () => devices.filter((device) => device.vehicle_id === vehicleId),
    [devices, vehicleId],
  );
  const bleVerified = Boolean(
    selectedDevice &&
    nearby.some(
      (device) =>
        device.id === matchedBleId &&
        matchesRegisteredDevice(device, selectedDevice),
    ),
  );

  async function refreshQueueCount() {
    setQueued((await readLocationQueue()).length);
  }

  async function loadAccount() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setProfile(null);
      return;
    }
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("user_id,name")
      .eq("auth_id", auth.user.id)
      .eq("status", "active")
      .single();
    if (userError || !user)
      throw new Error("找不到啟用中的人員帳號，請聯絡管理員。");
    const [
      { data: vehicleRows, error: vehicleError },
      { data: deviceRows, error: deviceError },
    ] = await Promise.all([
      supabase
        .from("official_vehicles")
        .select("vehicle_id,plate_no,vehicle_name")
        .eq("status", "active")
        .order("plate_no"),
      supabase
        .from("vehicle_tracking_devices")
        .select(
          "device_id,vehicle_id,display_name,advertised_name,device_fingerprint,service_uuid,verification_status,platform_identifiers",
        )
        .eq("status", "active")
        .order("display_name"),
    ]);
    if (vehicleError || deviceError)
      throw new Error("無法讀取公務車或藍牙設備資料，請確認定位系統權限。");
    setProfile(user as Profile);
    setVehicles((vehicleRows || []) as Vehicle[]);
    setDevices((deviceRows || []) as TrackingDevice[]);
    const stored = await readActiveSession();
    if (stored) {
      setActive(stored);
      setVehicleId(stored.vehicleId);
      setDeviceId(stored.deviceId);
      await startBackgroundTracking().catch(() =>
        setNotice("定位勤務仍在進行，但背景定位權限需要重新確認。"),
      );
    }
  }

  useEffect(() => {
    let disposed = false;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    void loadAccount().catch((error) =>
      setNotice(zhError(error, "讀取帳號失敗")),
    );
    void refreshQueueCount();
    const listener = supabase.auth.onAuthStateChange(
      () => {
        // Leave the auth callback before calling Supabase again (avoid its session lock).
        clearTimeout(authTimer);
        authTimer = setTimeout(() => {
          if (!disposed) void loadAccount().catch((error) =>
            setNotice(zhError(error, "讀取帳號失敗")),
          );
        }, 0);
      },
    );
    return () => {
      disposed = true;
      clearTimeout(authTimer);
      listener.data.subscription.unsubscribe();
      stopBleManager();
    };
  }, []);

  useEffect(() => {
    if (vehicleDevices.some((device) => device.device_id === deviceId)) return;
    setDeviceId(vehicleDevices[0]?.device_id || "");
    setMatchedBleId("");
  }, [vehicleId, vehicleDevices, deviceId]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(zhError(error, "操作失敗，請稍後再試。"));
    } finally {
      setBusy(false);
      await refreshQueueCount();
    }
  }

  async function login() {
    const configMessage = configurationError();
    if (configMessage) throw new Error(configMessage);
    if (!email.trim() || !password) throw new Error("請輸入電子郵件與密碼。");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error("帳號或密碼錯誤，或帳號尚未啟用。");
    setPassword("");
  }

  async function scan() {
    setNearby([]);
    setMatchedBleId("");
    setLastScanAt(0);
    setScanning(true);
    setNotice("正在掃描附近藍牙設備，約需 10 秒。");
    try {
      // Foreground discovery must not hide FT because an unverified service filter is wrong.
      const found = await scanNearbyDevices(setNearby);
      const match = selectedDevice && found.find(device => matchesRegisteredDevice(device, selectedDevice));
      setLastScanAt(Date.now());
      setMatchedBleId(match?.id || "");
      setNotice(match ? `掃描完成，已找到先前綁定的標籤：${match.name}`
        : found.length ? `掃描到 ${found.length} 個設備。掃描結果不代表已綁定；請確認實物後選取綁定。`
        : "未掃描到設備。請確認標籤電量與廣播狀態；若僅 FindTag 找得到，仍需確認原廠藍牙協定是否支援。");
    } finally {
      setScanning(false);
    }
  }

  async function bindNearbyDevice(nearbyDevice: NearbyBleDevice) {
    if (!selectedDevice) throw new Error("請先選擇要綁定的公務車藍牙設備。");
    if (Date.now() - lastScanAt > 60_000) throw new Error("掃描結果已逾一分鐘，請重新掃描再綁定。");
    // An arbitrary advertised service is not necessarily the background identification service.
    const serviceUuid = selectedDevice.service_uuid || null;
    const { error } = await supabase.rpc("bind_vehicle_tracking_ble_device", {
      p_device_id: selectedDevice.device_id,
      p_platform: Platform.OS,
      p_platform_identifier: nearbyDevice.id,
      p_advertised_name:
        nearbyDevice.name === "未命名藍牙設備" ? null : nearbyDevice.name,
      p_service_uuid: serviceUuid,
    });
    if (error)
      throw new Error(
        "藍牙設備綁定失敗，可能已綁定其他車輛，請聯絡管理員確認。",
      );
    setDevices((previous) =>
      previous.map((device) =>
        device.device_id === selectedDevice.device_id
          ? {
              ...device,
              advertised_name:
                device.advertised_name ||
                (nearbyDevice.name === "未命名藍牙設備"
                  ? null
                  : nearbyDevice.name),
              service_uuid: device.service_uuid || serviceUuid,
              verification_status:
                device.verification_status === "untested"
                  ? "scanning"
                  : device.verification_status,
              platform_identifiers: {
                ...(device.platform_identifiers || {}),
                [Platform.OS]: nearbyDevice.id,
              },
            }
          : device,
      ),
    );
    setMatchedBleId(nearbyDevice.id);
    setNotice(
      `已將 ${nearbyDevice.name} 綁定至所選公務車；正式使用前仍需由管理員完成硬體驗證。`,
    );
  }

  async function beginDuty() {
    if (!profile || !vehicleId || !selectedDevice)
      throw new Error("請先選擇公務車及藍牙設備。");
    if (!bleVerified || Date.now() - lastScanAt > 60_000)
      throw new Error("尚未在附近確認指定藍牙標籤，請先執行掃描。");
    const { data, error } = await supabase
      .from("vehicle_tracking_sessions")
      .insert({
        vehicle_id: vehicleId,
        device_id: selectedDevice.device_id,
        driver_id: profile.user_id,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version || "0.1.0",
      })
      .select("session_id")
      .single();
    if (error || !data)
      throw new Error("無法建立定位勤務，請確認此車目前沒有其他進行中的勤務。");
    const session: ActiveTrackingSession = {
      sessionId: data.session_id,
      vehicleId,
      deviceId: selectedDevice.device_id,
      driverId: profile.user_id,
      serviceUuid: selectedDevice.service_uuid,
      advertisedName: selectedDevice.advertised_name,
      platformIdentifier:
        selectedDevice.platform_identifiers?.[Platform.OS] ||
        matchedBleId ||
        null,
    };
    await writeActiveSession(session);
    try {
      await startBackgroundTracking();
    } catch (error) {
      await writeActiveSession(null);
      await supabase
        .from("vehicle_tracking_sessions")
        .update({
          status: "interrupted",
          ended_at: new Date().toISOString(),
          ended_reason: "定位權限未完成",
        })
        .eq("session_id", data.session_id);
      throw error;
    }
    setActive(session);
    setNotice("勤務已開始，手機會依移動狀態回傳定位。");
  }

  async function endDuty() {
    if (!active) return;
    await stopBackgroundTracking();
    await flushLocationQueue().catch(() => undefined);
    const { error } = await supabase
      .from("vehicle_tracking_sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
        ended_reason: "駕駛人結束勤務",
      })
      .eq("session_id", active.sessionId);
    if (error)
      throw new Error("勤務結束狀態暫時無法回傳，請保持網路後再試一次。");
    await writeActiveSession(null);
    setActive(null);
    setMatchedBleId("");
    setNotice("勤務已結束。");
  }

  const scanResults = nearby.length ? (
    <View style={styles.scanList}>
      {nearby.map((device) => {
        const bound = Boolean(selectedDevice && matchesRegisteredDevice(device, selectedDevice));
        return <View key={device.id} style={styles.scanRow}>
          <View style={styles.scanDetails}>
            <Text style={bound ? styles.match : styles.scanText}>{device.name}｜{device.rssi == null ? "訊號未知" : `${device.rssi} dBm`}</Text>
            <Text style={styles.scanIdentifier} selectable>本機識別碼：{device.id}</Text>
            <Text style={styles.scanIdentifier} selectable>廣播服務：{device.serviceUuids.join("、") || "未提供；背景相容性尚未確認"}</Text>
          </View>
          {profile && selectedDevice ? <Pressable
            style={[styles.bindButton, bound && styles.bindButtonMatched]}
            disabled={busy || Boolean(active) || bound}
            onPress={() => void run(() => bindNearbyDevice(device))}
          ><Text style={styles.bindButtonText}>{bound ? "已綁定" : "綁定"}</Text></Pressable> : null}
        </View>;
      })}
    </View>
  ) : null;

  if (!profile)
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.loginCard}>
          <Text style={styles.brand}>北農公務車定位</Text>
          <Text style={styles.subtitle}>使用公司帳號登入</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="電子郵件"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="密碼"
          />
          <Pressable
            style={styles.primary}
            disabled={busy}
            onPress={() => void run(login)}
          >
            <Text style={styles.primaryText}>{busy ? "登入中…" : "登入"}</Text>
          </Pressable>
          {notice ? <Text style={styles.error}>{notice}</Text> : null}
          <Pressable style={styles.secondary} disabled={busy} onPress={() => void run(scan)}>
            <Text style={styles.secondaryText}>{scanning ? "正在掃描…" : "免登入藍牙檢測"}</Text>
          </Pressable>
          <Text style={styles.disclaimer}>檢測只讀取附近藍牙廣播，不綁定車輛、不取得或上傳位置。iPhone 的本機識別碼可能不同於 FindTag 顯示的位址。</Text>
          {scanResults}
        </ScrollView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>北農公務車定位</Text>
            <Text style={styles.subtitle}>
              {profile.name}｜離線待傳 {queued} 筆
            </Text>
          </View>
          <Pressable
            onPress={() =>
              void run(async () => {
                if (active) throw new Error("請先結束勤務再登出。");
                await supabase.auth.signOut();
              })
            }
          >
            <Text style={styles.link}>登出</Text>
          </Pressable>
        </View>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.section}>1. 選擇公務車</Text>
        <View style={styles.choiceGrid}>
          {vehicles.map((vehicle) => (
            <Pressable
              key={vehicle.vehicle_id}
              disabled={busy || Boolean(active)}
              style={[
                styles.choice,
                vehicleId === vehicle.vehicle_id && styles.choiceActive,
              ]}
              onPress={() => setVehicleId(vehicle.vehicle_id)}
            >
              <Text style={styles.choiceTitle}>{vehicle.plate_no}</Text>
              <Text style={styles.choiceText}>
                {vehicle.vehicle_name || "公務車"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.section}>2. 確認車內藍牙標籤</Text>
        <View style={styles.choiceGrid}>
          {vehicleDevices.map((device) => (
            <Pressable
              key={device.device_id}
              disabled={busy || Boolean(active)}
              style={[
                styles.choice,
                deviceId === device.device_id && styles.choiceActive,
              ]}
              onPress={() => {
                setDeviceId(device.device_id);
                setMatchedBleId("");
              }}
            >
              <Text style={styles.choiceTitle}>{device.display_name}</Text>
              <Text style={styles.choiceText}>
                {device.verification_status === "verified"
                  ? "已完成實機驗證"
                  : "尚待實機驗證"}
              </Text>
            </Pressable>
          ))}
        </View>
        {!vehicleDevices.length && vehicleId ? (
          <Text style={styles.error}>此車尚未在後台綁定藍牙設備。</Text>
        ) : null}
        <Pressable
          style={styles.secondary}
          disabled={busy || Boolean(active)}
          onPress={() => void run(scan)}
        >
          <Text style={styles.secondaryText}>
            {scanning ? "正在掃描…" : "重新掃描附近藍牙設備"}
          </Text>
        </Pressable>
        {scanResults}
        <Text style={styles.section}>3. 定位勤務</Text>
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>
            {active ? "定位勤務進行中" : "尚未開始勤務"}
          </Text>
          <Text style={styles.statusText}>
            {active
              ? "請保持藍牙及定位權限開啟；斷網資料會先保存在手機。"
              : "開始後約每 30～60 秒依移動狀態回傳一次。"}
          </Text>
        </View>
        <Pressable
          style={active ? styles.danger : styles.primary}
          disabled={busy}
          onPress={() => void run(active ? endDuty : beginDuty)}
        >
          <Text style={styles.primaryText}>
            {busy ? "處理中…" : active ? "結束勤務" : "開始勤務"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const count = await flushLocationQueue();
              setNotice(
                count ? `已補傳 ${count} 筆定位資料。` : "目前沒有待補傳資料。",
              );
            })
          }
        >
          <Text style={styles.secondaryText}>立即補傳離線資料</Text>
        </Pressable>
        <Text style={styles.disclaimer}>
          iPhone 若由使用者強制關閉 App，背景定位會停止；重新開啟 App
          後才會恢復。正式使用前必須以實體 iPhone 與 Android
          手機驗證藍牙識別碼及耗電。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f2f7fb" },
  content: { padding: 18, gap: 14 },
  loginCard: {
    margin: 24,
    marginTop: 100,
    padding: 22,
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 18,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { fontSize: 25, fontWeight: "800", color: "#08223f" },
  subtitle: { marginTop: 5, color: "#64748b" },
  link: { color: "#0284c7", fontWeight: "700" },
  section: { marginTop: 8, fontSize: 18, fontWeight: "800", color: "#0f2742" },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  choiceGrid: { gap: 9 },
  choice: {
    padding: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  choiceActive: {
    borderWidth: 2,
    borderColor: "#0284c7",
    backgroundColor: "#e0f2fe",
  },
  choiceTitle: { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  choiceText: { marginTop: 3, color: "#64748b" },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#0284c7",
  },
  danger: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#dc2626",
  },
  primaryText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  secondaryText: { color: "#0369a1", fontWeight: "800" },
  notice: {
    padding: 12,
    borderRadius: 10,
    color: "#0c4a6e",
    backgroundColor: "#e0f2fe",
  },
  error: { color: "#b91c1c" },
  scanList: { padding: 12, gap: 9, borderRadius: 10, backgroundColor: "#fff" },
  scanRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scanDetails: { flex: 1, minWidth: 0 },
  scanIdentifier: { marginTop: 3, color: "#94a3b8", fontSize: 11 },
  scanText: { color: "#475569" },
  match: { color: "#047857", fontWeight: "800" },
  bindButton: {
    minWidth: 62,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: 9,
    backgroundColor: "#0284c7",
  },
  bindButtonMatched: { backgroundColor: "#059669" },
  bindButtonText: { color: "#fff", fontWeight: "800" },
  statusCard: { padding: 16, borderRadius: 14, backgroundColor: "#08223f" },
  statusTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  statusText: { marginTop: 6, color: "#cbd5e1", lineHeight: 21 },
  disclaimer: {
    marginVertical: 8,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 20,
  },
});
