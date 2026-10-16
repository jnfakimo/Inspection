'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { invokeAdminApi } from '@/lib/admin-api';
import {
  VEHICLE_LINE_SWITCHES,
  normalizeVehicleLinePersonalSettings,
  vehicleLineTestBlocker,
  type VehicleLinePersonalSettings,
} from '@/lib/vehicle-line-personal-settings';
import styles from './settings.module.css';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };

// 後台設定「LINE 推播」區塊中的公務車個人通知設定：
// 開關與測試都由 admin-api 在伺服器端驗證；測試會送出一則真實 LINE 訊息給固定測試帳號。
export default function VehicleLinePersonalPanel({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [settings, setSettings] = useState<VehicleLinePersonalSettings | null>(null);
  const [saved, setSaved] = useState<VehicleLinePersonalSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>('load');
  const [confirmTest, setConfirmTest] = useState(false);

  const load = useCallback(async () => {
    setBusy('load'); setLoadError('');
    try {
      const result = await invokeAdminApi<{ data?: unknown }>('admin_get_vehicle_line_personal_settings');
      const next = normalizeVehicleLinePersonalSettings(result.data);
      setSettings(next); setSaved(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '個人 LINE 通知設定讀取失敗');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    setBusy('save');
    try {
      await invokeAdminApi('admin_save_vehicle_line_personal_settings', {
        personal_enabled: settings.personal_enabled,
        assignment_enabled: settings.assignment_enabled,
        assignment_revoked_enabled: settings.assignment_revoked_enabled,
        test_enabled: settings.test_enabled,
      });
      onNotice({ kind: 'success', text: '公務車個人 LINE 通知設定已儲存。' });
      await load();
    } catch (error) {
      onNotice({ kind: 'error', text: `個人 LINE 通知設定儲存失敗：${error instanceof Error ? error.message : '未知錯誤'}` });
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test'); setConfirmTest(false);
    onNotice({ kind: 'info', text: '正在送出個人 LINE 測試訊息…' });
    try {
      const result = await invokeAdminApi<{ message?: string }>('admin_test_vehicle_line_personal_notification');
      onNotice({ kind: 'success', text: result.message || '測試訊息已送出，請向測試帳號確認是否收到。' });
    } catch (error) {
      onNotice({ kind: 'error', text: `個人 LINE 測試失敗：${error instanceof Error ? error.message : '未知錯誤'}` });
    } finally {
      setBusy(null);
    }
  };

  const recipient = settings?.test_recipient ?? null;
  const testBlocker = vehicleLineTestBlocker(saved, settings);

  return (
    <form className={styles.formPanel} onSubmit={save} aria-labelledby="vehicle-line-personal-title">
      <div className={styles.panelHeading}>
        <div>
          <h3 id="vehicle-line-personal-title">公務車個人 LINE 通知</h3>
          <p>司機在個人設定綁定本人 LINE 後，派車指派或取消指派時由系統個別通知；與上方群組推播分開設定，預設全部關閉。</p>
        </div>
        <div className={styles.headingActions}>
          <span className={settings?.personal_enabled ? styles.secretReady : styles.secretMissing}>
            {settings ? (settings.personal_enabled ? '個人通知已啟用' : '個人通知關閉') : '讀取中'}
          </span>
          <span className={styles.codeBadge}>SYS-07</span>
        </div>
      </div>

      {loadError ? (
        <div className={styles.formActions}>
          <p className={styles.helperText} role="alert">{loadError}</p>
          <button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={busy === 'load'}>重新讀取</button>
        </div>
      ) : (
        <>
          <fieldset className={styles.toggleGroup} disabled={!settings || busy !== null}>
            <legend>通知開關</legend>
            {VEHICLE_LINE_SWITCHES.map(({ key, label, description }) => (
              <label className={styles.toggleRow} key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings?.[key] ?? false}
                  onChange={event => setSettings(current => current ? { ...current, [key]: event.target.checked } : current)}
                />
              </label>
            ))}
          </fieldset>

          <p className={styles.helperText}>
            測試帳號：{recipient
              ? `${recipient.name || '（未命名）'}（${recipient.username}）— ${[
                recipient.active ? '帳號啟用' : '帳號停用',
                recipient.driver_active ? '在駕駛名冊' : '不在駕駛名冊',
                recipient.linked ? '已綁定 LINE' : '尚未綁定 LINE',
              ].join('、')}`
              : '找不到可用的測試帳號（022443 需為啟用中且在駕駛名冊）'}
          </p>

          {confirmTest && (
            <p className={styles.helperText} role="alert">
              確定要送出測試嗎？會傳一則<strong>真實的 LINE 訊息</strong>給測試帳號，內容固定，不會建立或變更任何派車案件。
            </p>
          )}

          <div className={styles.formActions}>
            <button className={styles.primaryButton} type="submit" disabled={!settings || busy !== null}>
              {busy === 'save' ? '儲存中…' : '儲存個人通知設定'}
            </button>
            {confirmTest ? (
              <>
                <button className={styles.primaryButton} type="button" onClick={() => void sendTest()} disabled={busy !== null}>確定送出測試</button>
                <button className={styles.secondaryButton} type="button" onClick={() => setConfirmTest(false)} disabled={busy !== null}>取消</button>
              </>
            ) : (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setConfirmTest(true)}
                disabled={busy !== null || Boolean(testBlocker)}
                title={testBlocker || undefined}
              >
                {busy === 'test' ? '傳送中…' : '發送個人測試訊息'}
              </button>
            )}
          </div>
          {testBlocker && <p className={styles.helperText}>{testBlocker}</p>}
        </>
      )}
    </form>
  );
}
