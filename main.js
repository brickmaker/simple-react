let nextUnitOfWork = null; // 待处理的任务，每个任务是要处理一个fiber node
let wipRoot = null; // 正在构建的fiber tree root
let currentRoot = null; // 已经构建好的 fiber tree root, wipRoot.alternate === currrentRoot
let deletionFibers = []; // 要删除的fiber node列表
let wipFiber = null; // 当前正在处理的fiber node，在hooks的实现中，需要对wipFiber的hooks和wipFiber.altnate中的副作用操作
let hookIndex = null; // 记录hook的index，用来得到wipFiber.alternate中的对应hook

/**
 * 工具函数，对text element的简易处理
 */
function createTextElement(text) {
  return {
    type: "TEXT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

/**
 * 工具函数，用来更新dom节点上的属性
 */
function updateDom(dom, prevProps, nextProps) {
  const isEvent = key => key.startsWith('on') // 事件类型的，特殊处理
  const isProperty = key => key !== 'children' && !isEvent(key)
  const isGone = (prev, next) => key => !(key in next)
  const isNew = (prev, next) => key => prev[key] !== next[key]

  // 事件属性的处理
  const isOldEvent = (prev, next) => key => isEvent(key) && (isGone(prev, next)(key) || isNew(prev, next)(key))
  const isNewEvent = (prev, next) => key => isEvent(key) && isNew(prev, next)(key)
  Object.keys(prevProps).filter(isOldEvent(prevProps, nextProps)).forEach(key => {
    const domEventname = key.substring(2).toLowerCase()
    dom.removeEventListener(domEventname, prevProps[key])
  })
  Object.keys(nextProps).filter(isNewEvent(prevProps, nextProps)).forEach(key => {
    const domEventname = key.substring(2).toLowerCase()
    dom.addEventListener(domEventname, nextProps[key])
  })

  // 其它属性的处理
  Object.keys(prevProps).filter(isProperty).filter(isGone(prevProps, nextProps)).forEach(key => dom[key] = '')
  Object.keys(nextProps).filter(isProperty).filter(isNew(prevProps, nextProps)).forEach(key => dom[key] = nextProps[key])

}

/**
 * 删除节点，有些节点并不是实际的element（如function component），因此需要递归删除
 */
function commitDeletion(fiber, parentDom) {
  if (fiber.dom) {
    parentDom.removeChild(fiber.dom)
  } else {
    commitDeletion(fiber.child, parentDom)
  }
}

/**
 * 对fiber node的commit操作，由于commit需要一次执行完毕，所以不采用workloop的方式
 */
function commitWork(fiber) {
  if (!fiber) return;

  // 找到父dom节点
  let parentFiberWithDom = fiber.parent
  while (!parentFiberWithDom.dom) {
    parentFiberWithDom = parentFiberWithDom.parent
  }
  const parentDom = parentFiberWithDom.dom

  if (fiber.effectTag === 'PLACEMENT' && fiber.dom) {
    // 新增DOM节点
    parentDom.appendChild(fiber.dom)
  } else if (fiber.effectTag === 'UPDATE' && fiber.dom) {
    // 更新DOM节点属性
    updateDom(fiber.dom, fiber.alternate.props, fiber.props)
  } else if (fiber.effectTag === 'DELETION') {
    // 删除节点
    commitDeletion(fiber, parentDom)
  }
  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

/**
 * commit阶段，实际更新dom
 */
function commitRoot() {
  deletionFibers.forEach(commitWork)
  commitWork(wipRoot.child)
  currentRoot = wipRoot
  wipRoot = null
}

/**
 * 创建dom节点，借用用updateDom来为新dom赋属性
 */
function createDom(fiber) {
  const dom =
    fiber.type === "TEXT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props)
  return dom;
}

/**
 * 函数组件，处理一些hooks相关的东西，然后执行这个函数，得到实际的children，得到children之后，和原生节点一样，进行reconciliation
 */
function updateFunctionComponent(fiber) {
  wipFiber = fiber // 因为可能有副作用，hooks的信息需要存在全局里
  hookIndex = 0
  wipFiber.hooks = []

  const children = [fiber.type(fiber.props)] // 运行函数组件，返回element
  reconcilChildren(fiber, children);
}

/**
 * 原生dom的fiber node，进行reconciliation操作
 */
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcilChildren(fiber, fiber.props.children);
}

/**
 * reconciliation，构建新的fiber node，标记fiber node是新增的/删除的/修改的，之后commit阶段进行不同的操作
 * 构建fiber tree的连接关系，从原先的children关系到sibling/parent/child的链表结构
 * 注意这里并没有递归的构建，而是只处理了children，有了链表关系之后，return nextUnitOfWork，workloop会进行后续的操作
 */
function reconcilChildren(wipFiber, children) {
  let prevSibling = null;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child; // 老的fiber tree已经构建好了，所以直接通过child/sibling逐个获取

  let i = 0;
  while (i < children.length || oldFiber) {
    let newFiber = null

    const child = children[i]
    const sameType = child && oldFiber && child.type === oldFiber.type;


    if (sameType) {
      // 同等类型，更新属性
      newFiber = {
        type: oldFiber.type,
        props: child.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: 'UPDATE'
      }
    } else if (child) {
      // 新增节点
      newFiber = {
        type: child.type,
        props: child.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: 'PLACEMENT'
      }
    } else if (oldFiber) {
      // 删除节点
      oldFiber.effectTag = 'DELETION';
      deletionFibers.push(oldFiber);
    }

    if (i === 0) {
      wipFiber.child = newFiber;
    } else if (child) {
      prevSibling.sibling = newFiber;
    }
    prevSibling = newFiber;

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }
    i += 1;
  }
}

/**
 * render节点的主要任务：构建fiber tree
 */
function performUnitWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)
  } else {
    updateHostComponent(fiber)
  }

  // 找到下一个待处理的fiber node
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling
    } else {
      nextFiber = nextFiber.parent // 最右边节点，一直上溯
    }
  }

  return null;
}

/**
 * 主循环
 * - 当有空闲时间片以及有待处理的fiber node的时候，处理
 * - 当wipRoot构建完毕，commit，更新dom
 */
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) { // 判断是否要挂起，不挂起挨个执行
    nextUnitOfWork = performUnitWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1 // 没有剩余的idle时间了，挂起
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  requestIdleCallback(workLoop)
}

/**
 * workLoop，空闲时候执行，用来模拟react的scheduler
 */
requestIdleCallback(workLoop)

/**
 * 创建fiber tree的根节点，让workLoop开启执行或许的render和commit
 */
function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element]
    },
    alternate: currentRoot,
  }

  deletionFibers = []
  nextUnitOfWork = wipRoot
}

/**
 * 工具函数，创建React Element
 */
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  };
}

/**
 * useState hook的实现
 */
function useState(initialValue) {
  const oldHook = wipFiber.alternate && wipFiber.alternate.hooks && wipFiber.alternate.hooks[hookIndex]
  const hook = {
    state: oldHook ? oldHook.state : initialValue,
    queue: [],
  }

  // 遍历actions，更新状态
  const actions = oldHook ? oldHook.queue : [];
  actions.forEach(action => hook.state = action(hook.state))

  const setState = action => {
    hook.queue.push(action)
    // 执行setState的时候要触发重新渲染，因此设置新的wipRoot，开启新一轮
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    }
    nextUnitOfWork = wipRoot
    deletionFibers = []
  }

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

export const Didact = {
  createElement,
  render,
  useState,
};
