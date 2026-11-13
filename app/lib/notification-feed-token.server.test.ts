import { generateKeyPairSync } from "node:crypto";
import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { notificationFeedConfig } from "./notification-feed-token.server";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const env = {
  KNOCK_PUBLIC_API_KEY: "pk_test",
  KNOCK_SIGNING_KEY: Buffer.from(privateKey).toString("base64"),
  KNOCK_FEED_CHANNEL_ID: "channel-1",
};

function claimsOf(token: string) {
  const [header, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

function isSignedByCadence(token: string) {
  const [header, payload, signature] = token.split(".");
  return createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(publicKey, Buffer.from(signature, "base64url"));
}

describe("notificationFeedConfig", () => {
  it("gives the browser the public key, channel and a token for that user", async () => {
    const config = await notificationFeedConfig(7, env);

    expect(config).toMatchObject({
      userId: "7",
      publicApiKey: "pk_test",
      feedChannelId: "channel-1",
    });
    expect(isSignedByCadence(config!.userToken)).toBe(true);
    expect(claimsOf(config!.userToken).sub).toBe("7");
  });

  it("signs a different subject for a different user", async () => {
    const first = await notificationFeedConfig(1, env);
    const second = await notificationFeedConfig(2, env);

    expect(claimsOf(first!.userToken).sub).toBe("1");
    expect(claimsOf(second!.userToken).sub).toBe("2");
  });

  it("is null without Knock keys, so the feed shows its empty state", async () => {
    expect(await notificationFeedConfig(7, {})).toBeNull();
    expect(
      await notificationFeedConfig(7, { ...env, KNOCK_SIGNING_KEY: "" })
    ).toBeNull();
  });
});
