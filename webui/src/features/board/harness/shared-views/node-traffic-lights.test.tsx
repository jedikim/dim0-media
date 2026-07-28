// Tests for the traffic-lights delete confirmation (durable deletes).
//
// Harness convention: no @testing-library/react — mount with vanilla
// `react-dom/client` under `act`. The red dot lives in the mounted container;
// the confirm dialog (Radix) portals to document.body, so we query the whole
// document for its buttons.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NodeTrafficLights } from "./node-traffic-lights"


const CONFIRM = { title: "Delete this document?", description: "Can't be undone." }


// Find a button by its exact trimmed text, searched across the whole document
// (the dialog's confirm button is portaled outside the mount container).
const buttonByText = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined


describe("NodeTrafficLights delete confirmation", () => {
  let container: HTMLDivElement
  let root: Root


  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })


  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })


  it("fires onDelete immediately when there is no confirm copy", () => {
    const onDelete = vi.fn()
    act(() => root.render(<NodeTrafficLights onDelete={onDelete} />))

    const red = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')
    act(() => red?.click())

    expect(onDelete).toHaveBeenCalledTimes(1)
  })


  it("does NOT fire onDelete on the first click — it opens the confirm dialog", () => {
    const onDelete = vi.fn()
    act(() => root.render(<NodeTrafficLights onDelete={onDelete} confirmDelete={CONFIRM} />))

    const red = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')
    act(() => red?.click())

    expect(onDelete).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(CONFIRM.title)
  })


  it("fires onDelete only after the dialog is confirmed", () => {
    const onDelete = vi.fn()
    act(() => root.render(<NodeTrafficLights onDelete={onDelete} confirmDelete={CONFIRM} />))

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')?.click())
    act(() => buttonByText("Delete")?.click()) // the dialog's confirm action

    expect(onDelete).toHaveBeenCalledTimes(1)
  })


  it("does not fire onDelete when the dialog is cancelled", () => {
    const onDelete = vi.fn()
    act(() => root.render(<NodeTrafficLights onDelete={onDelete} confirmDelete={CONFIRM} />))

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')?.click())
    act(() => buttonByText("Cancel")?.click())

    expect(onDelete).not.toHaveBeenCalled()
  })
})
