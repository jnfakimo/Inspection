import {notFound} from 'next/navigation';import {systems,findSystem} from '@/lib/modules';import {SystemHubClient} from './system-hub-client';
// 沒有子系統的系統（例如戰情儀表板，入口卡直接連到 /）不需要 hub 頁，
// 產生出來只會是一個點不進去的空頁。
export function generateStaticParams(){return systems.filter(system=>system.modules.length>0).map(system=>({system:system.key}))}
export default async function Page({params}:{params:Promise<{system:string}>}){const {system:key}=await params;const system=findSystem(key);if(!system)notFound();return <SystemHubClient system={system}/>}
