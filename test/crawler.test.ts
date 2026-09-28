import { expect, test } from "bun:test";
import { isCrawler } from "../src/crawler";

test("discord's preview bot is a crawler", () => {
  expect(isCrawler("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe(true);
});

test("a mixed-case telegram bot is a crawler", () => {
  expect(isCrawler("TelegramBot (like TwitterBot)")).toBe(true);
});

test("slack's link expander is a crawler", () => {
  expect(isCrawler("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(true);
});

test("facebook's external hit is a crawler", () => {
  expect(isCrawler("facebookexternalhit/1.1")).toBe(true);
});

test("whatsapp is a crawler", () => {
  expect(isCrawler("WhatsApp/2.23.20.0")).toBe(true);
});

test("curl is a crawler", () => {
  expect(isCrawler("curl/8.7.1")).toBe(true);
});

test("the same twitterbot user agent stays a crawler across repeated calls", () => {
  const ua = "Twitterbot/1.0";
  expect([isCrawler(ua), isCrawler(ua), isCrawler(ua)]).toEqual([true, true, true]);
});

test("desktop chrome is not a crawler", () => {
  expect(
    isCrawler(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ),
  ).toBe(false);
});

test("mobile safari is not a crawler", () => {
  expect(
    isCrawler(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
  ).toBe(false);
});

test("desktop firefox is not a crawler", () => {
  expect(
    isCrawler("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"),
  ).toBe(false);
});

test("android chrome is not a crawler", () => {
  expect(
    isCrawler(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    ),
  ).toBe(false);
});

test("an empty user agent is not a crawler", () => {
  expect(isCrawler("")).toBe(false);
});

test("a missing user agent is not a crawler", () => {
  expect(isCrawler(null)).toBe(false);
});
