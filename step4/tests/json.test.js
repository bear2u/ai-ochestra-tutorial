"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const json_1 = require("../src/utils/json");
(0, vitest_1.describe)("extractJsonObject", () => {
    (0, vitest_1.it)("extracts fenced json", () => {
        const input = "```json\n{\"a\":1}\n```";
        (0, vitest_1.expect)((0, json_1.extractJsonObject)(input)).toBe('{"a":1}');
    });
    (0, vitest_1.it)("extracts bare json", () => {
        const input = "Result:\n{\"ok\":true}";
        (0, vitest_1.expect)((0, json_1.extractJsonObject)(input)).toBe('{"ok":true}');
    });
    (0, vitest_1.it)("throws if missing json", () => {
        (0, vitest_1.expect)(() => (0, json_1.extractJsonObject)("hello")).toThrowError(/No JSON object/);
    });
});
