import json
import threading
import unittest
from unittest.mock import patch
from semantic.serve import SemanticRuntime
from semantic.planner import ContractError
from semantic.native import NativeModel, command as native_command

class FakeBackend:
    info = {'model': 'test'}
    def complete(self, messages, max_tokens, cancel_event=None):
        self.messages = messages
        return dict(raw=json.dumps(dict(meaning='平静汇报',affect_subject='none',speech_act='inform',delivery='calm',vad=[0,0,0],beats=[])),input_tokens=20,output_tokens=20,generation_ms=1,max_tokens_reached=False)

class SemanticRuntimeTests(unittest.TestCase):
    def test_contract_repair_is_bounded_and_recorded(self):
        class RepairBackend(FakeBackend):
            def __init__(self):self.count=0
            def complete(self,*args,**kwargs):
                self.count+=1;result=super().complete(*args,**kwargs)
                if self.count==1:result['raw']='{"invalid":true}'
                return result
        backend=RepairBackend();result=SemanticRuntime(backend).plan(dict(text='已经保存。'))
        self.assertEqual(result['contract_repairs'],1);self.assertEqual(len(result['attempts']),2)

    def test_actual_context_and_director_are_in_model_input_but_reference_answers_are_not(self):
        backend=FakeBackend();runtime=SemanticRuntime(backend)
        result=runtime.plan(dict(text='已经保存。',context='普通汇报',director_instruction='不要挥手',expected='GOLD',utterance='已经保存。'))
        self.assertEqual(result['semantic_plan']['speech_act'],'inform')
        request=json.loads(backend.messages[1]['content'])
        self.assertEqual(request['director_instruction'],'不要挥手')
        self.assertNotIn('GOLD',str(backend.messages))

    def test_cancelled_session_cannot_publish_a_late_plan(self):
        runtime=SemanticRuntime(FakeBackend());runtime.cancel('old')
        with self.assertRaises(ContractError):runtime.plan(dict(session_id='old',text='你好。'))
        event=threading.Event();runtime.active=('now',event);runtime.cancel('now')
        self.assertTrue(event.is_set())

    def test_empty_and_nontext_requests_are_rejected(self):
        runtime=SemanticRuntime(FakeBackend())
        for text in ('',None,1):
            with self.subTest(text=text),self.assertRaises(ContractError):runtime.plan(dict(text=text))

    def test_one_complete_paragraph_enters_model_once_with_no_duplicate_utterance(self):
        backend=FakeBackend();text='这是第一句。这是第二句，我们继续。'
        result=SemanticRuntime(backend).plan(dict(text=text,utterance=text))
        request=json.loads(backend.messages[1]['content'])
        self.assertEqual(request['avatar_text'],text);self.assertNotIn(text,request['context']);self.assertEqual(result['contract_repairs'],0)
        self.assertEqual(SemanticRuntime(backend).plan(dict(text='好'*300))['contract_repairs'],0)
        with self.assertRaises(ContractError):SemanticRuntime(backend).plan(dict(text='好'*301))

    def test_native_client_uses_local_schema_stream_and_rejects_truncation(self):
        class Response:
            def __init__(self,rows):self.rows=rows
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def __iter__(self):return iter(self.rows)
        backend=NativeModel()
        def row(value):return b'data: '+json.dumps(value).encode()+b'\n\n'
        rows=[row({'choices':[{'delta':{'content':'{"meaning":"ok"}'},'finish_reason':None}]}),
              row({'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':7}}),b'data: [DONE]\n\n']
        with patch.object(backend.opener,'open',return_value=Response(rows)) as opened:
            result=backend.complete([{'role':'user','content':'你好'}],30)
            payload=json.loads(opened.call_args.args[0].data)
            self.assertEqual(payload['response_format']['schema']['additionalProperties'],False)
            self.assertFalse(payload['chat_template_kwargs']['enable_thinking']);self.assertTrue(payload['stream'])
            self.assertEqual(result['output_tokens'],7);self.assertEqual(result['raw'],'{"meaning":"ok"}')
        with patch.object(backend.opener,'open',return_value=Response(rows[:1])):
            with self.assertRaises(ContractError):backend.complete([],30)
        event=threading.Event();event.set()
        with self.assertRaises(ContractError):backend.complete([],30,cancel_event=event)

    def test_native_launcher_is_offline_and_can_explicitly_use_cpu(self):
        with patch('semantic.native.Path.is_file',return_value=True):
            args=native_command('cuda');self.assertEqual(args[args.index('--host')+1],'127.0.0.1');self.assertIn('--offline',args)
            args=native_command('cpu');self.assertEqual(args[args.index('-ngl')+1],'0')

if __name__=='__main__':unittest.main()
