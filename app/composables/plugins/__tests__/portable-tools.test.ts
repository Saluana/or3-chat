import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({source: null as any, call:vi.fn(), register:vi.fn(), dispose:vi.fn()}));
vi.mock('../portable-client-runtime',()=>({getPortableClientSource:()=>mocks.source,invokePortableToolRequest:mocks.call}));
vi.mock('~/utils/chat/tools-public',()=>({useToolRegistry:()=>({registerTool:mocks.register})}));
import {registerPortableTools} from '../portable-tools';
const definition={type:'function',function:{name:'or3sal_tasks_search_lists',description:'Find lists',parameters:{type:'object',properties:{query:{type:'string'}},additionalProperties:false}}};
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.source={workspaceId:'one',descriptor:{descriptorKey:'v1',effectiveGrants:['tools.register.client']}};
 mocks.call.mockResolvedValue([definition]);
 mocks.register.mockReturnValue({dispose:mocks.dispose});
});
it('requires the workspace tool grant before starting discovery',async()=>{
 mocks.source.descriptor.effectiveGrants=[];
 await registerPortableTools('or3sal.tasks');
 expect(mocks.call).not.toHaveBeenCalled();
 expect(mocks.register).not.toHaveBeenCalled();
});
it('registers disabled client tools, runs in the sandbox, and disposes them',async()=>{
 const dispose=await registerPortableTools('or3sal.tasks');
 const [def,handler]=mocks.register.mock.calls[0]!;
 expect(def).toMatchObject({runtime:'client',ui:{defaultEnabled:false}});
 mocks.call.mockResolvedValue({lists:[]});
 expect(await handler({query:'work'})).toBe('{"lists":[]}');
 expect(mocks.call).toHaveBeenLastCalledWith('or3sal.tasks','runtime.tool',{name:definition.function.name,args:{query:'work'}});
 dispose();expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('refuses execution after a workspace or descriptor change',async()=>{
 await registerPortableTools('or3sal.tasks');
 const [,handler,options]=mocks.register.mock.calls[0]!;
 mocks.source={workspaceId:'two',descriptor:{descriptorKey:'v1',effectiveGrants:['tools.register.client']}};
 expect(options.available()).toBe(false);
 await expect(handler({})).rejects.toThrow('workspace or version changed');
});
it('rejects foreign tool names and discards registration when discovery races teardown',async()=>{
 mocks.call.mockResolvedValue([{...definition,function:{...definition.function,name:'other_delete'}}]);
 await expect(registerPortableTools('or3sal.tasks')).rejects.toThrow('namespace');
 mocks.call.mockImplementation(async()=>{mocks.source=null;return [definition];});
 await registerPortableTools('or3sal.tasks');
 expect(mocks.register).not.toHaveBeenCalled();
});
it('cleans up partial registration and strips publisher enablement metadata',async()=>{
 mocks.call.mockResolvedValue([{...definition,defaultEnabled:true}, {...definition,function:{...definition.function,name:'or3sal_tasks_other'}}]);
 mocks.register.mockReturnValueOnce({dispose:mocks.dispose}).mockImplementationOnce(()=>{throw new Error('collision');});
 await expect(registerPortableTools('or3sal.tasks')).rejects.toThrow('collision');
 expect(mocks.dispose).toHaveBeenCalledOnce();
 expect(mocks.register.mock.calls[0]![0].defaultEnabled).toBeUndefined();
});
