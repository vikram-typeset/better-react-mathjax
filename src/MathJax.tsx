import React, {ComponentPropsWithoutRef, FC, useContext, useLayoutEffect, useRef} from "react"
import { MathJaxBaseContext, MathJaxOverrideableProps } from "./MathJaxContext"

export interface MathJaxProps extends MathJaxOverrideableProps {
    inline?: boolean
    onInitTypeset?: () => void
    text?: string
    dynamic?: boolean
}

/**
 *
 * This component wraps an inline or block element with content that should be typeset by MathJax. It will, with
 * renderMode = "post" attempt to typeset after every render and thus a few things are important:
 *
 *    - The wrapped component must only be rerendered after higher-hierarchy state changes, it must not be able to
 *      trigger a rerender of itself only, as this will NOT trigger a rerender of the MathJax wrapper and thus, any
 *      content in the wrapped component will NOT be processed by MathJax. If you have such a situation, wrap a smaller
 *      portion of the initially wrapped component instead and put the state in a higher-hierarchy component.
 *      Introducing several MathJax components may be done to solve the problem as well.
 *
 *      -Don't nest MathJax components as this will introduce unnecessary work (several components typeset the same math).
 *
 */

const MathJax: FC<MathJaxProps & ComponentPropsWithoutRef<"div" | "span">> = ({
    inline = false,
    hideUntilTypeset,
    onInitTypeset,
    text,
    dynamic,
    typesettingOptions,
    renderMode,
    children,
    id,
    ...rest
}) => {
    // in render mode "pre", this keeps track of the last value on text to determine when we need to run typesetting
    const lastChildren = useRef<string>("")

    /* the parent of all MathJax content, in render mode "pre" the content generated by MathJax is added to this node
    after rendering whereas in render mode "post", the content of this node is processed by MathJax after rendering */
    const ref = useRef<HTMLElement>(null)

    const mjPromise = useContext(MathJaxBaseContext)

    // allow context values to steer this component for some props if they are undefined
    const usedHideUntilTypeset = hideUntilTypeset === undefined ? mjPromise?.hideUntilTypeset : hideUntilTypeset
    const usedRenderMode = renderMode === undefined ? mjPromise?.renderMode : renderMode
    const usedConversionOptions = typesettingOptions === undefined ? mjPromise?.typesettingOptions : typesettingOptions

    // whether initial typesetting of this element has been done or not
    const initLoad = useRef(false)

    // mutex to signal when typesetting is ongoing
    const typesetting = useRef(false)

    // handler for initial loading
    const checkInitLoad = () => {
        if (!initLoad.current) {
            if (usedHideUntilTypeset === "first" && ref.current !== null) {
                ref.current.style.visibility = "visible"
            }
            if (onInitTypeset) onInitTypeset()
            initLoad.current = true
        }
    }

    // callback for when typesetting is done
    const onTypesetDone = () => {
        if (usedHideUntilTypeset === "every" && ref.current !== null) {
            ref.current.style.visibility = "visible"
        }
        checkInitLoad()
        typesetting.current = false
    }

    // validator for text input with renderMode = "pre"
    const validText = (inputText?: string) => typeof inputText === "string" && inputText.length > 0

    // guard which resets the visibility to hidden when hiding the content between every typesetting
    if (
        !typesetting.current &&
        ref.current !== null &&
        dynamic &&
        usedHideUntilTypeset === "every" &&
        usedRenderMode === "post"
    ) {
        ref.current.style.visibility = "hidden"
    }

    /**
     * Effect for typesetting, important that this does not trigger a new render and runs as seldom as possible (only
     * when needed). It is good that it is in an effect because then we are sure that the DOM has finished updating and
     * thus, we don't have to use a custom timeout to accommodate for this (otherwise we might see a FOUC).
     *
     * Note: useEffect does not run on SSR so no extra care taken of not running with Promise.resolve() from context
     * (which happens on SSR) on server.
     */
    useLayoutEffect(() => {
        if (dynamic || !initLoad.current) {
            if (ref.current !== null) {
                if (mjPromise) {
                    if (usedRenderMode === "pre") {
                        if (!validText(text))
                            throw Error(
                                `Render mode 'pre' requires text prop to be set and non-empty, which was currently "${text}"`
                            )
                        if (!typesettingOptions || !typesettingOptions.fn)
                            throw Error(
                                "Render mode 'pre' requires 'typesettingOptions' prop with 'fn' property to be set on MathJax element or in the MathJaxContext"
                            )
                        if (mjPromise.version === 2)
                            throw Error(
                                "Render mode 'pre' only available with MathJax 3, and version 2 is currently in use"
                            )
                    }
                    if (usedRenderMode === "post" || text !== lastChildren.current) {
                        if (!typesetting.current) {
                            typesetting.current = true
                            mjPromise.promise
                                .then((mathJax) => {
                                    if (mjPromise.version === 3) {
                                        if (usedRenderMode === "pre") {
                                            const updateFn = (output: HTMLElement) => {
                                                lastChildren.current = text!
                                                mathJax.startup.document.clear()
                                                mathJax.startup.document.updateDocument()
                                                if (ref.current !== null) ref.current.innerHTML = output.outerHTML
                                                onTypesetDone()
                                            }
                                            if (typesettingOptions!.fn.endsWith("Promise"))
                                                mathJax.startup.promise
                                                    .then(() =>
                                                        mathJax[usedConversionOptions!.fn](text, {
                                                            ...(usedConversionOptions?.options || {}),
                                                            display: !inline
                                                        })
                                                    )
                                                    .then(updateFn)
                                                    .catch((err: any) => {
                                                        onTypesetDone()
                                                        throw Error(`Typesetting failed: ${err.message}`)
                                                    })
                                            else
                                                mathJax.startup.promise
                                                    .then(() => {
                                                        const output = mathJax[usedConversionOptions!.fn](text, {
                                                            ...(usedConversionOptions?.options || {}),
                                                            display: !inline
                                                        })
                                                        updateFn(output)
                                                    })
                                                    .catch((err: any) => {
                                                        onTypesetDone()
                                                        throw Error(`Typesetting failed: ${err.message}`)
                                                    })
                                        } else {
                                            // renderMode "post"
                                            mathJax.startup.promise
                                                .then(() => {
                                                    mathJax.typesetClear([ref.current])
                                                    // mathJax.typeset([ref.current])
                                                    return mathJax.typesetPromise([ref.current])
                                                })
                                                .then(onTypesetDone)
                                                .catch((err: any) => {
                                                    onTypesetDone()
                                                    throw Error(`Typesetting failed: ${err.message}`)
                                                })
                                        }
                                    } else {
                                        // version 2
                                        mathJax.Hub.Queue(["Typeset", mathJax.Hub, ref.current])
                                        mathJax.Hub.Queue(onTypesetDone)
                                    }
                                })
                                .catch((err) => {
                                    throw Error(`Typesetting failed: ${err.message}`)
                                })
                        }
                    }
                } else
                    throw Error(
                        "MathJax was not loaded, did you use the MathJax component outside of a MathJaxContext?"
                    )
            }
        }
    })

    return (
        <span
            {...rest}
            id={id}
            style={{
                display: inline ? "inline" : "block",
                ...rest.style,
                visibility: usedHideUntilTypeset ? "hidden" : undefined
            }}
            ref={ref}
        >
            {children}
        </span>
    )
}

export default MathJax
