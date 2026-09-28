import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEmbed } from "../src/instagram";

const EGG_MEDIA =
  "https://scontent.cdninstagram.com/v/t51.82787-15/625727639_18338153224242257_3827527793310630488_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=104&ig_cache_key=MTk0OTUyNTI3ODI4MTU1NDE3NA%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuNTg0LnNkci5yZWd1bGFyX3Bob3RvLkMzIn0%3D&_nc_ohc=YFKQ7apkKBgQ7kNvwFPu0Kb&_nc_oc=AdpCt06dwZzFQWP2kuK7UAFMK0HuszeeTFaClp9t3JPyJWmjm73K0jYkykuO01tHcww&_nc_zt=23&_nc_ht=scontent-tpe5-1.cdninstagram.com&_nc_gid=xwo3Asg41MB0RjldQ8lgQA&_nc_ss=7360f&oh=00_AQO3J7DVx6YxxYqCZcy3W0xiufLg5WnZQJeoc7uz04uViQ&oe=6ABFE180";

const SESSION_TOKEN = /"(csrf_token|token|ajaxpipe_token|compat_iframe_token)":"[^"]+"/;
const CSRF_COOKIE = /\["csrftoken","[^"]+"/;

function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/instagram/${name}`, import.meta.url)).text();
}

test("a single-image embed yields the account and the cdninstagram image", async () => {
  const post = parseEmbed(await fixture("embed-BsOGulcndj-.html"));
  expect(post?.username).toBe("world_record_egg");
  expect(post?.mediaUrl).toBe(EGG_MEDIA);
});

test("a minimal GraphImage embed keeps the image query and an empty caption", () => {
  const post = parseEmbed(
    '<div data-media-type="GraphImage"><span class="UsernameText">a_b</span><img class="EmbeddedMediaImage" alt="x" src="https://scontent-xyz.cdninstagram.com/v/p.jpg?a=1&amp;oe=ABC" srcset="https://other.example/s.jpg 640w"></div>',
  );
  expect(post).toEqual({
    username: "a_b",
    caption: "",
    mediaUrl: "https://scontent.cdninstagram.com/v/p.jpg?a=1&oe=ABC",
  });
});

test("saved embed fixtures do not contain session tokens", async () => {
  const dir = new URL("./fixtures/instagram/", import.meta.url);
  const names = await readdir(fileURLToPath(dir.href));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const text = await Bun.file(new URL(name, dir)).text();
    expect(text.match(SESSION_TOKEN)).toBeNull();
    expect(text.match(CSRF_COOKIE)).toBeNull();
  }
});
