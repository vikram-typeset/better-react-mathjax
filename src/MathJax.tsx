import React, { ComponentPropsWithoutRef, FC, useContext, useEffect, useLayoutEffect, useRef } from "react"
import { MathJaxBaseContext, MathJaxOverrideableProps } from "./MathJaxContext"

export interface MathJaxProps extends MathJaxOverrideableProps {
    inline?: boolean
    onInitTypeset?: () => void
    onTypeset?: () => void
    text?: string
    dynamic?: boolean
}

const typesettingFailed = (err: any) =>
    `Typesetting failed: ${typeof err.message !== "undefined" ? err.message : err.toString()}`

const MathJax: FC<MathJaxProps & ComponentPropsWithoutRef<"span">> = ({
    inline = false,
    hideUntilTypeset,
    onInitTypeset,
    onTypeset,
    text,
    dynamic,
    typesettingOptions,
    renderMode,
    children,
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

    // mutex to signal when typesetting is ongoing (without it we may have race conditions)
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
        if (usedHideUntilTypeset === "every" && dynamic && usedRenderMode === "post" && ref.current !== null) {
            ref.current.style.visibility = "visible"
        }
        checkInitLoad()
        if (onTypeset) onTypeset()
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
     * when needed). It is good that it is in an effect because then we are sure that the DOM to be is ready and
     * thus, we don't have to use a custom timeout to accommodate for this. Layout effects runs on the DOM to be before
     * the browser has a chance to paint. Thereby, we reduce the chance of ugly flashes of non-typeset content.
     *
     * Note: useLayoutEffect causes an ugly warning in the server console with SSR so we make sure to use useEffect if
     * we are in the backend instead. Neither of them run in the backend so no extra care needs to be taken of the
     * Promise.reject() passed from context (which happens on SSR) on server.
     */
    const effectToUse = typeof window !== "undefined" ? useLayoutEffect : useEffect
    effectToUse(() => {
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
                            if (mjPromise.version === 3) {
                                mjPromise.promise
                                    .then((mathJax) => {
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
                                                    .catch((err) => {
                                                        onTypesetDone()
                                                        throw Error(typesettingFailed(err))
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
                                                    .catch((err) => {
                                                        onTypesetDone()
                                                        throw Error(typesettingFailed(err))
                                                    })
                                        } else {
                                            // renderMode "post"
                                            mathJax.startup.promise
                                                .then(() => {
                                                    mathJax.typesetClear([ref.current])
                                                    return mathJax.typesetPromise([ref.current])
                                                })
                                                .then(onTypesetDone)
                                                .catch((err) => {
                                                    onTypesetDone()
                                                    throw Error(typesettingFailed(err))
                                                })
                                        }
                                    })
                                    .catch((err) => {
                                        onTypesetDone()
                                        throw Error(typesettingFailed(err))
                                    })
                            } else {
                                // version 2
                                mjPromise.promise
                                    .then((mathJax) => {
                                        mathJax.Hub.Queue(["Typeset", mathJax.Hub, ref.current])
                                        mathJax.Hub.Queue(onTypesetDone)
                                    })
                                    .catch((err) => {
                                        onTypesetDone()
                                        throw Error(typesettingFailed(err))
                                    })
                            }
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
