import React from "react";

export const LoadingBlock = ({label}: {label?: string}) => {
    return <div className="component-loading-block block has-text-centered">
        <span className="icon-text">
            <span className="icon">
                <img src="/loading.svg" alt="Loading..." />
            </span>
            { label ? <span> {label}</span> : null }
        </span>
    </div>;
};
