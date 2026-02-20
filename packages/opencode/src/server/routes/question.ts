import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Agent } from "../../agent/agent"
import { Identifier } from "../../id/id"
import { Provider } from "../../provider/provider"
import { Question } from "../../question"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

async function model(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

async function switchAgent(sessionID: string, agent: string) {
  if (!(await Agent.get(agent))) return
  const msg: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent,
    model: await model(sessionID),
  }
  await Session.updateMessage(msg)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID,
    type: "text",
    text: "User confirmed and switched to build agent. Continue working.",
    synthetic: true,
  } satisfies MessageV2.TextPart)
}

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: {
              "application/json": {
                schema: resolver(Question.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const questions = await Question.list()
        return c.json(questions)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
        operationId: "question.reply",
        responses: {
          200: {
            description: "Question answered successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      validator("json", Question.Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const sessionID = await Question.reply({
          requestID: params.requestID,
          answers: json.answers,
        })
        if (json.agent && sessionID) await switchAgent(sessionID, json.agent)
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
        operationId: "question.reject",
        responses: {
          200: {
            description: "Question rejected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Question.reject(params.requestID)
        return c.json(true)
      },
    ),
)
