import {notFound} from 'next/navigation';import {allModuleParams,findModule,findSystem} from '@/lib/modules';import {ModuleWorkspace} from './workspace';
export function generateStaticParams(){return allModuleParams}
export default async function Page({params}:{params:Promise<{system:string;module:string}>}){const {system:systemKey,module:moduleKey}=await params;const system=findSystem(systemKey),module=findModule(systemKey,moduleKey);if(!system||!module)notFound();return <ModuleWorkspace system={system} module={module}/>}
