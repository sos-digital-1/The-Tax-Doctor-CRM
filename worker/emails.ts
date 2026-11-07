import { Env, sendMail } from "./lib";

const appUrl = (env: Env, fallback = "") => (env.APP_URL || fallback).replace(/\/$/, "");
const sign = "\n\nRegards,\nThe Tax Doctor";

type U = { id?: number; name: string; email: string };

/** New staff account: credentials mail. The user must choose their own password at first sign-in. */
export const mailUserCreated = (env: Env, u: U, tempPassword: string, origin: string) =>
  sendMail(env, {
    to: u.email, toName: u.name, kind: "USER_CREATED",
    subject: "Your Tax Doctor account is ready",
    text:
      `Hello ${u.name},\n\nAn account has been created for you on The Tax Doctor team portal.\n\n` +
      `Sign in: ${appUrl(env, origin)}\nEmail: ${u.email}\nTemporary password: ${tempPassword}\n\n` +
      `You will be asked to choose your own password the first time you sign in.\n` +
      `After signing in, open "Get the apps" to install the Windows or Android app.${sign}`,
  });

/** Admin reset: a new temporary password, again replaced at next sign-in. */
export const mailAdminReset = (env: Env, u: U, tempPassword: string, origin: string) =>
  sendMail(env, {
    to: u.email, toName: u.name, kind: "PASSWORD_RESET",
    subject: "Your Tax Doctor password was reset",
    text:
      `Hello ${u.name},\n\nAn administrator reset your password.\n\n` +
      `Sign in: ${appUrl(env, origin)}\nEmail: ${u.email}\nTemporary password: ${tempPassword}\n\n` +
      `You will be asked to choose a new password when you sign in.${sign}`,
  });

/** Forgot-password link (valid for one hour, single use). */
export const mailResetLink = (env: Env, u: U, link: string) =>
  sendMail(env, {
    to: u.email, toName: u.name, kind: "PASSWORD_RESET",
    subject: "Reset your Tax Doctor password",
    text:
      `Hello ${u.name},\n\nWe received a request to reset your password. Use this link within 60 minutes:\n\n${link}\n\n` +
      `If you did not ask for this, you can ignore this email - your password stays the same.${sign}`,
  });

export const mailPasswordChanged = (env: Env, u: U) =>
  sendMail(env, {
    to: u.email, toName: u.name, kind: "PASSWORD_CHANGED",
    subject: "Your Tax Doctor password was changed",
    text: `Hello ${u.name},\n\nYour password was just changed. If this was not you, contact your administrator immediately.${sign}`,
  });
