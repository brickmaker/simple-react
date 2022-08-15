import { Didact } from "./main";


function App({ name }) {
    const [count, setCount] = Didact.useState(0)
    return Didact.createElement(
        "div",
        { id: "xxx" },
        Didact.createElement("p", null, `Count: ${count}`),
        Didact.createElement("button", {
            onClick: () => {
                setCount(v => v + 1)
            }
        }, 'increase')
    );
}
Didact.render(Didact.createElement(App, {
    name: 'hahah'
}), document.getElementById("app"));
