import "@testing-library/jest-dom";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import InfoTooltip from "../InfoTooltip";

afterEach(cleanup);

describe("InfoTooltip", () => {
  it("does not render the tooltip until the trigger is hovered or focused", () => {
    render(<InfoTooltip text="Composite score breakdown" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the tooltip on hover and hides it on mouse leave", () => {
    render(<InfoTooltip text="Composite score breakdown" />);
    const trigger = screen.getByRole("button");

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Composite score breakdown",
    );

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the tooltip on keyboard focus and hides on blur", () => {
    render(<InfoTooltip text="Reach explanation" />);
    const trigger = screen.getByRole("button");

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders the open tooltip in a portal attached to document.body, NOT inside the trigger's parent container", () => {
    // This is the core of the robust clipping fix: the popover must escape any
    // ancestor with `overflow` set (e.g. the scrollable Post Scorecard table),
    // which is only guaranteed if it is portaled out of the trigger subtree.
    const { container } = render(
      // Simulate the clipping container the tooltip lives inside in production.
      <div style={{ overflow: "auto" }} data-testid="clip">
        <InfoTooltip text="Escapes the clip container" />
      </div>,
    );

    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole("tooltip");
    // The tooltip must NOT be a descendant of the rendered container subtree.
    expect(container).not.toContainElement(tooltip);
    // It must live under document.body directly (the portal target).
    expect(document.body).toContainElement(tooltip);
  });

  it("toggles on pointer-down (touch tap) and does not close itself via the focus path", () => {
    // On touch, a tap fires focus then click. The component suppresses implicit
    // focus on pointerdown and toggles there, so a single tap must OPEN (not
    // immediately re-close) the tooltip.
    render(<InfoTooltip text="Tap to toggle" />);
    const trigger = screen.getByRole("button");

    fireEvent.pointerDown(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.pointerDown(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("links the trigger to the tooltip via aria-describedby when open", () => {
    render(<InfoTooltip text="Accessible description" />);
    const trigger = screen.getByRole("button");

    expect(trigger).not.toHaveAttribute("aria-describedby");
    fireEvent.focus(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("splits bullet-delimited text into separate lines", () => {
    render(
      <InfoTooltip text="Composite • Reach 40% • Engagement 30% • Saves 30%" />,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Reach 40%");
    expect(tooltip).toHaveTextContent("Engagement 30%");
    expect(tooltip).toHaveTextContent("Saves 30%");
  });

  it("uses the provided accessible label on the trigger", () => {
    render(<InfoTooltip text="Some text" label="What is reach?" />);
    expect(
      screen.getByRole("button", { name: "What is reach?" }),
    ).toBeInTheDocument();
  });
});
