export type FeatureProfileName = "paper-chat-lean";

export type FeatureProfile = {
  name: FeatureProfileName;
  sendFlow: {
    useLeanPaperChatFastPath: boolean;
  };
};

const PAPER_CHAT_LEAN_PROFILE: FeatureProfile = {
  name: "paper-chat-lean",
  sendFlow: {
    useLeanPaperChatFastPath: true,
  },
};

export function getFeatureProfile(): FeatureProfile {
  return PAPER_CHAT_LEAN_PROFILE;
}

export function isPaperChatLeanProfile(): boolean {
  return getFeatureProfile().name === "paper-chat-lean";
}
