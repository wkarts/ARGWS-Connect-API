const ct = () => {
      const e = y.useContext(UM);
      if (!e) throw new Error('useInstance must be used within an InstanceProvider');
      return e;
    };
