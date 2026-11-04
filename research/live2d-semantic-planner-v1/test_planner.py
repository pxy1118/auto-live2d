import copy
import json
from pathlib import Path
import unittest

from planner import LocalAPI, ContractError, messages_for, parse_plan, read_cases


class SemanticContractTests(unittest.TestCase):
    def setUp(self):
        self.plan = {"meaning": "平静确认收到消息", "affect_subject": "none", "speech_act": "confirm",
                     "delivery": "calm", "vad": [0, -.2, 0], "beats": []}

    def parse(self, plan, text="嗯，我知道了。嗯，我知道了。"):
        return parse_plan(json.dumps(plan, ensure_ascii=False), text)

    def beat(self, anchor="嗯", occurrence=0, movement="optional", strength="small"):
        return {"anchor": anchor, "occurrence": occurrence, "intent": "acknowledge", "movement": movement, "strength": strength}

    def test_authored_answers_and_case_ids_never_enter_model_request(self):
        case = {"avatar_text": "你可真行。", "expected": {"reading": "SENTINEL_GOLD_ANSWER"}, "case_id": "SECRET_LABEL"}
        prompt = json.dumps(messages_for(case), ensure_ascii=False)
        self.assertNotIn("SENTINEL_GOLD_ANSWER", prompt)
        self.assertNotIn("SECRET_LABEL", prompt)

    def test_quiet_plan_is_valid_without_forcing_a_motion(self):
        self.assertEqual(self.parse(self.plan)["beats"], [])

    def test_nonexistent_anchor_is_rejected(self):
        self.plan["beats"] = [self.beat("不存在的台词")]
        with self.assertRaises(ContractError):
            self.parse(self.plan)

    def test_repeated_anchor_requires_real_occurrence_and_chronological_order(self):
        self.plan["beats"] = [self.beat(occurrence=1)]
        self.parse(self.plan)
        self.plan["beats"] = [self.beat(occurrence=2)]
        with self.assertRaises(ContractError):
            self.parse(self.plan)
        self.plan["beats"] = [self.beat(occurrence=1), self.beat(occurrence=0)]
        with self.assertRaises(ContractError):
            self.parse(self.plan)

    def test_numeric_booleans_nan_and_extra_parameters_are_rejected(self):
        for value in (True, float("nan"), float("inf"), 1.1):
            plan = copy.deepcopy(self.plan)
            plan["vad"][0] = value
            with self.subTest(value=value), self.assertRaises(ContractError):
                self.parse(plan)
        self.plan["ParamMouthOpenY"] = 1
        with self.assertRaises(ContractError):
            self.parse(self.plan)

    def test_duplicate_json_fields_and_markdown_are_not_silently_salvaged(self):
        raw = json.dumps(self.plan)
        for bad in (raw[:-1] + ', "meaning": "override"}', "```json\n" + raw + "\n```"):
            with self.assertRaises(ValueError):
                parse_plan(bad, "嗯")

    def test_movement_requires_consistent_strength(self):
        self.plan["beats"] = [self.beat(movement="none", strength="large")]
        with self.assertRaises(ContractError):
            self.parse(self.plan)
        self.plan["beats"] = [self.beat(movement="required", strength="none")]
        with self.assertRaises(ContractError):
            self.parse(self.plan)

    def test_input_is_not_silently_truncated(self):
        with self.assertRaises(ContractError):
            messages_for({"avatar_text": "长" * 12001})

    def test_only_loopback_model_endpoints_are_accepted(self):
        for url in ("https://example.invalid/v1", "http://0.0.0.0:8000/v1", "http://127.0.0.1.example.invalid/v1"):
            with self.assertRaises(ValueError):
                LocalAPI(url, "reference", 1)
        self.assertTrue(LocalAPI("http://127.0.0.1:11434/v1", "local", 1).info["local"])
        with self.assertRaises(ValueError):
            LocalAPI("https://secret@localhost/v1", "local", 1)

    def test_twenty_diagnostic_cases_are_valid_inputs(self):
        rows = read_cases(Path(__file__).with_name("semantic-diagnostic-cases.json"))
        self.assertEqual(len(rows), 20)
        for row in rows:
            messages_for(row)


if __name__ == "__main__":
    unittest.main()
