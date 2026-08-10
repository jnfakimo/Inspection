import {notFound} from 'next/navigation';import {systems,findSystem} from '@/lib/modules';import {SystemHubClient} from './system-hub-client';
export function generateStaticParams(){return systems.map(system=>({system:system.key}))}
export default async function Page({params}:{params:Promise<{system:string}>}){const {system:key}=await params;const system=findSystem(key);if(!system)notFound();return <SystemHubClient system={system}/>}
