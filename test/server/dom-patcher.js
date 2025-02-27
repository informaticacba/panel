import '../../lib/isorender/dom-shims';

import chai, {expect} from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import {DOMPatcher, h} from '../../lib/dom-patcher';
import nextAnimationFrame from './nextAnimationFrame';
import * as Perf from '../../lib/component-utils/perf';

chai.use(sinonChai);

describe(`dom-patcher`, function () {
  context(`when first initialized`, function () {
    const fooState = {foo: `bar`};
    const domPatcher = new DOMPatcher(fooState, (state) => h(`div`, `Value of foo: ${state.foo}`));

    it(`applies initial state`, function () {
      expect(domPatcher.state).to.eql(fooState);
    });

    it(`copies the initial state`, function () {
      expect(domPatcher.state).to.eql(fooState);
      expect(domPatcher.state).not.to.equal(fooState);
    });

    it(`defaults to async mode`, function () {
      expect(domPatcher.updateMode).to.eql(`async`);
    });

    it(`creates a target DOM element`, function () {
      expect(domPatcher.el).to.be.ok;
      expect(domPatcher.el).to.be.an.instanceOf(Node);
    });

    it(`applies the first patch immediately`, function () {
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
    });
  });

  describe(`target DOM element`, function () {
    let el;

    function patcherEl(renderFunc) {
      return new DOMPatcher({}, renderFunc).el;
    }

    it(`matches the tag type of the vtree root`, function () {
      el = patcherEl(() => h(`div`));
      expect(el.tagName).to.eql(`div`);

      el = patcherEl(() => h(`span`));
      expect(el.tagName).to.eql(`span`);
    });

    it(`applies classes from the vtree root`, function () {
      el = patcherEl(() => h(`span.foo`));
      expect(el.className).to.eql(`foo`);

      el = patcherEl(() => h(`span.foo.bar`));
      expect(el.className).to.eql(`foo bar`);
    });

    it(`applies id from the vtree root`, function () {
      el = patcherEl(() => h(`span`));
      expect(el.id).to.not.exist;

      el = patcherEl(() => h(`span#foo`));
      expect(el.id).to.eql(`foo`);
    });

    it(`combines classes and id from the vtree root`, function () {
      el = patcherEl(() => h(`span#foo.bar`));
      expect(el.id).to.eql(`foo`);
      expect(el.className).to.eql(`bar`);

      el = patcherEl(() => h(`span#foo.bar.baz`));
      expect(el.id).to.eql(`foo`);
      expect(el.className).to.eql(`bar baz`);
    });
  });

  context(`in sync mode`, function () {
    it(`renders updates immediately`, function () {
      const domPatcher = new DOMPatcher({foo: `bar`}, (state) => h(`div`, `Value of foo: ${state.foo}`), {
        updateMode: `sync`,
      });
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      domPatcher.update({foo: `moo`});
      expect(domPatcher.el.textContent).to.eql(`Value of foo: moo`);
      expect(domPatcher.pending).to.be.false;
      expect(domPatcher.rendering).to.be.false;
    });
  });

  context(`in async mode`, function () {
    let domPatcher;

    beforeEach(function () {
      domPatcher = new DOMPatcher({foo: `bar`}, (state) => h(`div`, `Value of foo: ${state.foo}`), {
        updateMode: `async`,
      });
    });

    it(`does not render updates immediately`, function () {
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      domPatcher.update({foo: `moo`});
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      expect(domPatcher.pending).to.be.true;
    });

    it(`renders updates on the next animation frame`, async function () {
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      domPatcher.update({foo: `moo`});

      await nextAnimationFrame();

      expect(domPatcher.el.textContent).to.eql(`Value of foo: moo`);
    });

    it(`applies only the last state in a given frame`, async function () {
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      domPatcher.update({foo: `moo`});
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);
      domPatcher.update({foo: `whew`});
      expect(domPatcher.el.textContent).to.eql(`Value of foo: bar`);

      await nextAnimationFrame();

      expect(domPatcher.el.textContent).to.eql(`Value of foo: whew`);
    });
  });

  context(`when disconnected`, function () {
    it(`cleans up references to be GC friendly`, function () {
      const domPatcher = new DOMPatcher({foo: `bar`}, () => h(`div`));
      domPatcher.disconnect();

      expect(domPatcher.renderFunc).to.equal(null);
      expect(domPatcher.state).to.equal(null);
      expect(domPatcher.vnode).to.equal(null);
      expect(domPatcher.el).to.equal(null);
    });
  });

  describe(`postRenderCallback`, function () {
    afterEach(() => sinon.restore());
    it(`is not called on initial render`, function () {
      const postRenderCallbackSpy = sinon.spy();
      new DOMPatcher({foo: `bar`}, (state) => h(`div`, `Value of foo: ${state.foo}`), {
        postRenderCallback: postRenderCallbackSpy,
        updateMode: `sync`,
      });
      expect(postRenderCallbackSpy).not.to.have.been.called;
    });

    it(`is called after update`, function () {
      const postRenderCallbackSpy = sinon.spy();
      const domPatcher = new DOMPatcher({foo: `bar`}, (state) => h(`div`, `Value of foo: ${state.foo}`), {
        postRenderCallback: postRenderCallbackSpy,
        updateMode: `sync`,
      });
      expect(postRenderCallbackSpy).not.to.have.been.called;
      domPatcher.update({foo: `whew`});
      expect(postRenderCallbackSpy).to.have.been.calledOnce;
    });

    it(`is passed the elapsed time`, async function () {
      let elapsedTime = null;
      const domPatcher = new DOMPatcher({foo: `bar`}, (state) => h(`div`, `Value of foo: ${state.foo}`), {
        postRenderCallback: (time) => {
          elapsedTime = time;
        },
        updateMode: `async`,
      });
      const getNowStub = sinon.stub(Perf, `getNow`);
      getNowStub.onCall(0).returns(5);
      getNowStub.onCall(1).returns(25);

      domPatcher.update({foo: `whew`});
      await nextAnimationFrame();
      expect(elapsedTime).to.eql(20);
    });
  });
});
