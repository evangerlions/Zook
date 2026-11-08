import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_env import env_file


class RuntimeEnvTest(unittest.TestCase):
    def read(self, value):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime.env"
            path.write_text(value, encoding="utf-8")
            return env_file(path)

    def test_quotes_literals_and_no_environment_mutation(self):
        previous = dict(os.environ)
        result = self.read("# comment\nZOOK_PARSER_TEST=\"value$literal\"\nSINGLE='文字=1'\nEMPTY=\n")
        self.assertEqual(result, {"ZOOK_PARSER_TEST": "value$literal", "SINGLE": "文字=1", "EMPTY": ""})
        self.assertEqual(dict(os.environ), previous)

    def test_invalid_and_multiline_values_fail(self):
        for value in ['missing-equals', 'BAD-KEY=value', 'KEY="line\\nline"', 'KEY="null\\u0000"', 'KEY="line\\rline"']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read(value)


if __name__ == "__main__":
    unittest.main()
